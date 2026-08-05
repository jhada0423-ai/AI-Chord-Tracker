#!/usr/init/env python3
# -*- coding: utf-8 -*-

"""
===================================================================================
Project Name : AI-Chord-Tracker (Backend - Audio Source Separation Core Engine)
Description  : 
    - OpenUnmix 기반 딥러닝 음원 분리 코어 모듈입니다.
    - 단일 오디오의 STFT 복소 스펙트로그램을 입력받아 각 악기별 마스크를 추정합니다.
    - 일반적인 Griffin-Lim의 음질 저하를 보완하기 위해, 기댓값 최대화(EM) 기반의 
      위너 필터(Wiener Filter) 알고리즘을 적용하여 소스 간 간섭을 최소화하고 
      고해상도 오디오 WAV 파형으로 정밀 복원합니다.
    - 환경변수(`.env`) 기반 설정을 적용하여 이식성을 극대화했습니다.

Author       : Jang Dong-il
===================================================================================
"""

import os
import sys
import logging
from typing import Optional, Mapping
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch import Tensor
from torch.nn import LSTM, BatchNorm1d, Linear

import torchaudio
import torchaudio.transforms as T
import soundfile as sf
from dotenv import load_dotenv

# --- 0. 환경변수 로드 및 글로벌 로깅 설정 ---
load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s (PID:%(process)d): %(message)s"
)
logger = logging.getLogger("SeparationCore-Wiener")

# --- 1. 디바이스 자동 감지 설정 ---
device = torch.device("cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu"))
logger.info(f"OpenUnmix Wiener separation core initialized on device: {device}")

# --- 2. 모델 가중치 경로 환경변수 주입 ---
VOCAL_MODEL_PATH = os.getenv("VOCAL_MODEL_PATH", "./models/openunmix_vocal.pth")
DRUM_MODEL_PATH = os.getenv("DRUM_MODEL_PATH", "./models/openunmix_drum.pth")
BASS_MODEL_PATH = os.getenv("BASS_MODEL_PATH", "./models/openunmix_bass.pth")
OTHER_MODEL_PATH = os.getenv("OTHER_MODEL_PATH", "./models/openunmix_other.pth")


def check_model_paths() -> bool:
    """
    4개 악기별 가중치 파일(.pth)의 디스크 존재 여부를 검증합니다.

    Returns:
        bool: 모든 모델 파일이 존재하면 True, 하나라도 없으면 False
    """
    paths = {
        "vocals": VOCAL_MODEL_PATH, 
        "drums": DRUM_MODEL_PATH, 
        "bass": BASS_MODEL_PATH, 
        "other": OTHER_MODEL_PATH
    }
    all_exist = True
    for name, path in paths.items():
        if not path or not os.path.exists(path):
            logger.error(f"Missing model weight file for '{name}': {path}")
            all_exist = False
        else:
            logger.info(f"Verified model weight path for '{name}': {path}")
    return all_exist


def load_model(path: str) -> nn.Module:
    """
    특정 경로의 `.pth` 파일을 로드하여 평가 모드로 전환된 OpenUnmix 인스턴스를 반환합니다.

    Args:
        path (str): 모델 가중치 파일 경로

    Returns:
        nn.Module: 로드된 OpenUnmix 모델
    """
    if not path or not os.path.exists(path):
        raise FileNotFoundError(f"Model file does not exist at target path: {path}")
    
    logger.info(f"Loading OpenUnmix model weights from: {path}")
    model = OpenUnmix(nb_channels=1).to(device)
    try:
        checkpoint = torch.load(path, map_location=device)
        model.load_state_dict(checkpoint)
        model.eval()
        logger.info(f"Successfully loaded and verified model: {path}")
        return model
    except Exception as e:
        logger.error(f"Failed to load model state dict from {path}: {e}", exc_info=True)
        raise e


# --------------------------------------------------------------------------
# OpenUnmix 핵심 신경망 클래스
# --------------------------------------------------------------------------
class OpenUnmix(nn.Module):
    """
    OpenUnmix 코어 신경망 모듈 클래스입니다.
    """
    def __init__(
        self,
        nb_bins: int = 2049,
        nb_channels: int = 1,
        hidden_size: int = 1024,
        nb_layers: int = 4,
        unidirectional: bool = False,
        input_mean: Optional[np.ndarray] = None,
        input_scale: Optional[np.ndarray] = None,
        max_bin: Optional[int] = None,
    ):
        super(OpenUnmix, self).__init__()

        self.nb_output_bins = nb_bins
        self.nb_bins = max_bin if max_bin is not None and max_bin > 0 else self.nb_output_bins
        self.nb_channels = nb_channels
        self.hidden_size = hidden_size

        self.fc1 = Linear(self.nb_channels * self.nb_bins, hidden_size, bias=False)
        self.bn1 = BatchNorm1d(hidden_size)
        
        lstm_hidden_size = hidden_size // 2 if not unidirectional else hidden_size
        self.lstm = LSTM(
            input_size=hidden_size, 
            hidden_size=lstm_hidden_size,
            num_layers=nb_layers, 
            bidirectional=not unidirectional,
            batch_first=False, 
            dropout=0.4 if nb_layers > 1 else 0,
        )
        
        fc2_input_size = hidden_size + (lstm_hidden_size * 2 if not unidirectional else lstm_hidden_size)
        self.fc2 = Linear(fc2_input_size, hidden_size, bias=False)
        self.bn2 = BatchNorm1d(hidden_size)
        self.fc3 = Linear(hidden_size, self.nb_channels * self.nb_output_bins, bias=False)
        self.bn3 = BatchNorm1d(self.nb_channels * self.nb_output_bins)

        input_feature_size = self.nb_channels * self.nb_bins
        input_mean_tensor = torch.from_numpy(-input_mean.flatten()[:input_feature_size]).float() if isinstance(input_mean, np.ndarray) else torch.zeros(input_feature_size)
        input_scale_tensor = torch.from_numpy(1.0 / input_scale.flatten()[:input_feature_size]).float() if isinstance(input_scale, np.ndarray) else torch.ones(input_feature_size)

        self.register_buffer('input_mean', input_mean_tensor)
        self.register_buffer('input_scale', input_scale_tensor)

        output_feature_size = self.nb_channels * self.nb_output_bins
        self.register_buffer('output_scale', torch.ones(output_feature_size).float())
        self.register_buffer('output_mean', torch.zeros(output_feature_size).float())

    def freeze(self):
        """모델 파라미터의 그래디언트 업데이트를 비활성화합니다."""
        for param in self.parameters():
            param.requires_grad = False
        self.eval()

    def forward(self, x: Tensor) -> Tensor:
        """
        입력 파워 스펙트로그램을 받아 마스크가 적용된 추정 소스 스펙트로그램을 반환합니다.

        Args:
            x (Tensor): 입력 파워 스펙트로그램 (B, C, F, T)

        Returns:
            Tensor: 추정된 소스 파워 스펙트로그램 (B, C, F, T)
        """
        x = x.permute(3, 0, 1, 2)
        nb_frames, nb_samples, nb_channels, nb_total_bins = x.shape
        mix = x[..., : self.nb_output_bins].detach().clone()

        x_input = x[..., : self.nb_bins]
        x = x_input.reshape(nb_frames * nb_samples, self.nb_channels * self.nb_bins)
        x = (x + self.input_mean.to(x.device)) * self.input_scale.to(x.device)

        x = torch.tanh(self.bn1(self.fc1(x)))
        x = x.reshape(nb_frames, nb_samples, self.hidden_size)
        lstm_out, _ = self.lstm(x)
        x = torch.cat([x, lstm_out], dim=-1)
        x = x.reshape(nb_frames * nb_samples, x.shape[-1])
        x = F.relu(self.bn2(self.fc2(x)))
        x = self.bn3(self.fc3(x))
        x = x.reshape(nb_frames, nb_samples, self.nb_channels, self.nb_output_bins)

        mask = F.relu(x)
        estimated_power = mask * mix
        return estimated_power.permute(1, 2, 3, 0)


# --------------------------------------------------------------------------
# Separator 클래스 (EM 기반 위너 필터 적용 버전)
# --------------------------------------------------------------------------
class Separator(nn.Module):
    """
    STFT 변환과 EM 기반 위너 필터(Wiener Filter)를 활용해 정밀한 음원 분리를 수행하는 클래스입니다.
    """
    def __init__(
        self,
        target_models: Mapping[str, nn.Module],
        sample_rate: float = 44100.0,
        n_fft: int = 4096,
        n_hop: int = 1024,
        nb_channels: int = 1,
        residual: bool = False,
    ):
        super(Separator, self).__init__()

        self.residual = residual
        self.sample_rate = sample_rate
        self.n_fft = n_fft
        self.n_hop = n_hop
        self.nb_channels = nb_channels

        # STFT 복소 스펙트로그램 추출용 트랜스폼 설정 (return_complex=True 필수)
        self.stft = T.Spectrogram(
            n_fft=self.n_fft,
            hop_length=self.n_hop,
            power=None, # 복소수(Complex) 스펙트로그램 반환
            center=True,
            window_fn=torch.hann_window,
        ).to(device)
        
        # 역 STFT (ISTFT) 트랜스폼 설정
        self.istft = T.InverseSpectrogram(
            n_fft=self.n_fft,
            hop_length=self.n_hop,
            window_fn=torch.hann_window,
        ).to(device)

        self.target_models = nn.ModuleDict(target_models)
        self.nb_targets = len(self.target_models)

    def freeze(self):
        """내부 서브모델들의 그래디언트 연산을 동결합니다."""
        for p in self.parameters():
            p.requires_grad = False
        self.eval()
        for model in self.target_models.values():
            model.freeze()

    def forward(self, audio: Tensor) -> Tensor:
        """
        입력 오디오에 대해 EM 기반 위너 필터링을 수행하여 악기별로 분리된 오디오 파형을 추정합니다.

        Args:
            audio (Tensor): 입력 오디오 파형 텐서 (B, C, T)

        Returns:
            Tensor: 분리된 오디오 소스 텐서 (B, S, C, T)
        """
        nb_samples, nb_channels_input, nb_timesteps = audio.shape
        curr_device = audio.device
        
        self.stft.to(curr_device)
        self.istft.to(curr_device)
        for model in self.target_models.values():
            model.to(curr_device)

        # 1. 복소 STFT 스펙트로그램 및 파워 스펙트로그램 계산
        X_complex = self.stft(audio) # Complex Tensor (B, C, F, T)
        X_power = X_complex.abs().pow(2) # Power Spectrogram (B, C, F, T)

        # 2. 각 악기별 신경망을 통한 파워 스펙트럼 추정
        nb_bins = X_power.shape[2]
        nb_frames = X_power.shape[3]
        
        estimates_power = torch.zeros(
            nb_samples, self.nb_channels, nb_bins, nb_frames, self.nb_targets,
            dtype=X_power.dtype, device=curr_device
        )
        
        for j, (name, module) in enumerate(self.target_models.items()):
            estimates_power[..., j] = module(X_power.clone())

        # 3. EM 기반 위너 필터(Wiener Filter) 적용하여 다중 소스 간 간섭 최소화 및 복원
        # 총 추정 에너지 합계 계산
        sum_estimates = estimates_power.sum(dim=-1, keepdim=True) + 1e-10
        
        estimates_audio = torch.zeros(
            nb_samples, self.nb_targets, self.nb_channels, nb_timesteps,
            dtype=audio.dtype, device=curr_device
        )

        for s_idx in range(self.nb_targets):
            # 위너 필터 마스크 계산 (소스 파워 / 총 파워)
            source_power = estimates_power[..., s_idx]
            wiener_mask = source_power / sum_estimates.squeeze(-1)
            
            # 복소 스펙트로그램에 위너 필터 마스크를 곱하여 해당 악기의 복소 스펙트럼 추출
            # X_complex 채널 확장 맞춤
            wiener_mask_expanded = wiener_mask.unsqueeze(1) if wiener_mask.ndim == 3 else wiener_mask
            source_complex = X_complex * wiener_mask_expanded

            # 역 STFT(ISTFT)를 통해 시간 도메인 WAV 파형으로 정밀 복원
            reconstructed_audio = self.istft(source_complex, length=nb_timesteps)
            estimates_audio[:, s_idx, :, :] = reconstructed_audio

        return estimates_audio


def initialize_separator() -> Optional[Separator]:
    """
    4개의 악기 모델 가중치를 로드하여 EM 위너 필터 기반 Separator 인스턴스를 초기화합니다.

    Returns:
        Optional[Separator]: 초기화된 Separator 객체 또는 실패 시 None
    """
    logger.info("Initializing Wiener-based Separator components...")
    if not check_model_paths():
        logger.error("Model path validation failed. Separator initialization aborted.")
        return None
    try:
        loaded_models = {
            "vocals": load_model(VOCAL_MODEL_PATH),
            "drums": load_model(DRUM_MODEL_PATH),
            "bass": load_model(BASS_MODEL_PATH),
            "other": load_model(OTHER_MODEL_PATH),
        }
        logger.info("All 4 instrument sub-models loaded successfully for Wiener separation.")
        
        separator = Separator(
            loaded_models,
            sample_rate=44100.0, 
            n_fft=4096, 
            n_hop=1024, 
            nb_channels=1,
            residual=False
        ).to(device)
        
        separator.freeze()
        logger.info("Wiener-based Separator instance fully assembled.")
        return separator
    except Exception as e:
        logger.error(f"Critical Error during Wiener Separator initialization: {e}", exc_info=True)
        return None


def separate_instruments_process(file_path: str, output_dir: str, separator: Separator) -> dict:
    """
    오디오 파일을 로드하고 리샘플링을 거쳐 EM 위너 필터 기반 분리를 수행한 뒤 트랙별 WAV로 저장합니다.

    Args:
        file_path (str): 입력 오디오 파일 경로
        output_dir (str): 분리된 파일 저장 디렉토리
        separator (Separator): 초기화된 Separator 인스턴스

    Returns:
        dict: 악기 이름과 저장된 WAV 파일 경로가 매핑된 딕셔너리
    """
    os.makedirs(output_dir, exist_ok=True)
    if separator is None:
        raise RuntimeError("Separator instance is not initialized.")

    logger.info(f"Loading target audio file for Wiener separation: {file_path}")
    try:
        waveform, sr = torchaudio.load(file_path)
        logger.info(f"Audio loaded successfully. Original shape: {waveform.shape}, Sample Rate: {sr}Hz")

        if waveform.ndim == 1:
            waveform = waveform.unsqueeze(0).unsqueeze(0)
        elif waveform.ndim == 2:
            if waveform.shape[0] > 1:
                waveform = waveform.mean(dim=0, keepdim=True)
            waveform = waveform.unsqueeze(0)
        elif waveform.ndim == 3 and waveform.shape[0] > 1:
            waveform = waveform[0].unsqueeze(0)
            if waveform.shape[1] > 1:
                waveform = waveform.mean(dim=1, keepdim=True)

        target_sr = int(separator.sample_rate)
        if sr != target_sr:
            logger.info(f"Resampling audio sample rate from {sr}Hz to {target_sr}Hz")
            resampler = T.Resample(orig_freq=sr, new_freq=target_sr).to(waveform.device)
            waveform = resampler(waveform)

        waveform = waveform.to(device)

    except Exception as e:
        logger.error(f"Failed to load or preprocess audio stream: {e}", exc_info=True)
        raise RuntimeError(f"Audio preprocessing failed: {e}")

    output_files = {}
    try:
        output_names = list(separator.target_models.keys())
    except AttributeError:
        raise RuntimeError("Invalid Separator internal model state.")

    logger.info("Executing EM Wiener source separation pipeline...")
    try:
        estimates = separator(waveform) # (Batch, Sources, Channels, Time)
        estimates = estimates.squeeze(0) # (Sources, Channels, Time)

        for i, name in enumerate(output_names):
            output_waveform = estimates[i, :, :].cpu()
            output_path = os.path.join(output_dir, f"{name}.wav")
            output_waveform_np = output_waveform.squeeze(0).numpy()
            
            sf.write(output_path, output_waveform_np, target_sr)
            output_files[name] = output_path
            logger.info(f"Successfully exported Wiener-separated track '{name}' to: {output_path}")

    except Exception as e:
        logger.error(f"Error during Wiener separation inference or file export: {e}", exc_info=True)
        raise RuntimeError(f"Separation process failed: {e}")

    return output_files