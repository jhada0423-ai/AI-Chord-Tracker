#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
===================================================================================
Project Name : AI-Chord-Tracker (Backend - Chord Recognition Engine)
Description  : 
    - CNN-LSTM-CRF 딥러닝 아키텍처를 활용하여 오디오 스트림에서 실시간으로 코드를 추론합니다.
    - Music21 기반 음악 이론 분석 및 다이어토닉(Diatonic) 보정 알고리즘을 결합하여 
      추론 정확도를 극대화하고 마디 단위(Measure)로 구조화된 악보 데이터를 제공합니다.
    - FastAPI 비동기 이벤트 루프 최적화 및 스레드 풀 오프로딩(Offloading)을 적용하여 
      동시성 처리 성능을 강화했습니다.

Author       : Jang Dong-il
===================================================================================
"""

import os
import base64
import math
import logging
from typing import List, Dict, Any, Set
from collections import Counter
import asyncio

import librosa
import numpy as np
import torch
import torch.nn as nn
from fastapi import FastAPI, File, UploadFile, Request, HTTPException
from fastapi.responses import JSONResponse
import yt_dlp
from allennlp.modules import ConditionalRandomField
from music21 import key, chord, pitch
from dotenv import load_dotenv

# --- 0. 환경변수 로드 및 글로벌 로깅 포맷 설정 ---
load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s (PID:%(process)d): %(message)s"
)
logger = logging.getLogger("ChordAPI-Engine")

# --- 1. 글로벌 상수 및 설정 (Configuration Constants) ---
SR = int(os.getenv("SR", 22050))
N_BINS = int(os.getenv("N_BINS", 252))
HOP_LENGTH = int(os.getenv("HOP_LENGTH", 512))
BINS_PER_OCTAVE = int(os.getenv("BINS_PER_OCTAVE", 36))
FRAMES_PER_SEQ = int(os.getenv("FRAMES_PER_SEQ", 32))
DEFAULT_BEATS_PER_MEASURE = int(os.getenv("DEFAULT_BEATS_PER_MEASURE", 4))
MIN_RMS_THRESHOLD = float(os.getenv("MIN_RMS_THRESHOLD", 0.03))
MIN_CHORD_DURATION = float(os.getenv("MIN_CHORD_DURATION", 0.25))
SMOOTHING_WINDOW_SIZE = int(os.getenv("SMOOTHING_WINDOW_SIZE", 3))

MODEL_PATH = os.getenv("CHORD_MODEL_PATH", "./models/4best_chord_model.pth")
DOWNLOAD_DIR = os.getenv("DOWNLOAD_DIR", "./downloads")
TEMP_UPLOAD_DIR = os.getenv("TEMP_UPLOAD_DIR", "./temp_uploads")

os.makedirs(DOWNLOAD_DIR, exist_ok=True)
os.makedirs(TEMP_UPLOAD_DIR, exist_ok=True)


###############################################
# 2. 음악 이론 매핑 및 역매핑 딕셔너리 정의
###############################################
mapping = {
    'Root': { 'N': 0, 'C': 1, 'C#': 2, 'Db': 3, 'D': 4, 'D#': 5, 'Eb': 6, 'E': 7, 'Fb': 8, 'E#': 9, 'F': 10, 'F#': 11, 'Gb': 12, 'G': 13, 'G#': 14, 'Ab': 15, 'A': 16, 'A#': 17, 'Bb': 18, 'B': 19, 'Cb': 20 },
    'Triad':  {'maj': 0, 'min': 1, 'dim': 2, 'aug': 3, 'sus4': 4, 'sus2': 5},
    'Bass':   { 'N': 0, 'C': 1, 'C#': 2, 'Db': 3, 'D': 4, 'D#': 5, 'Eb': 6, 'E': 7, 'Fb': 8, 'E#': 9, 'F': 10, 'F#': 11, 'Gb': 12, 'G': 13, 'G#': 14, 'Ab': 15, 'A': 16, 'A#': 17, 'Bb': 18, 'B': 19, 'Cb': 20 },
    '7th':  {'N': 0, '7': 1}, 
    '9th':  {'N': 0, '9': 1}, 
    '11th': {'N': 0, '11': 1}, 
    '13th': {'N': 0, '13': 1}
}

root_map_inv = {v: k for k, v in mapping['Root'].items()}
triad_map_inv = {v: k for k, v in mapping['Triad'].items()}
bass_map_inv = {v: k for k, v in mapping['Bass'].items()}
_7th_map_inv = {v: k for k, v in mapping['7th'].items()}
_9th_map_inv = {v: k for k, v in mapping['9th'].items()}
_11th_map_inv = {v: k for k, v in mapping['11th'].items()}
_13th_map_inv = {v: k for k, v in mapping['13th'].items()}


###############################################
# 3. 딥러닝 모델 아키텍처 (CNN + Bidirectional LSTM + CRF)
###############################################
class ChordNetWithCRF(nn.Module):
    """
    CNN, 양방향 LSTM, CRF 계층을 결합하여 오디오 스펙트로그램으로부터 
    루트 노트, 트라이드, 확장 화음을 동시에 추론하는 멀티태스킹 딥러닝 모델 클래스입니다.
    """
    def __init__(self, num_classes_dict: dict):
        """
        ChordNetWithCRF 모델을 초기화합니다.

        Args:
            num_classes_dict (dict): 각 코드 속성별 클래스 개수를 담은 딕셔너리
        """
        super(ChordNetWithCRF, self).__init__()
        
        self.cnn = nn.Sequential(
            nn.Conv2d(1, 16, kernel_size=(3, 3), padding=(1, 1)),
            nn.BatchNorm2d(16),
            nn.ReLU(),
            nn.MaxPool2d((2, 1)),
            nn.Dropout(0.3),

            nn.Conv2d(16, 32, kernel_size=(3, 3), padding=(1, 1)),
            nn.BatchNorm2d(32),
            nn.ReLU(),
            nn.MaxPool2d((2, 1)),
            nn.Dropout(0.3),

            nn.Conv2d(32, 64, kernel_size=(3, 3), padding=(1, 1)),
            nn.BatchNorm2d(64),
            nn.ReLU(),
            nn.MaxPool2d((2, 1)),
            nn.Dropout(0.3),

            nn.Conv2d(64, 128, kernel_size=(3, 3), padding=(1, 1)),
            nn.BatchNorm2d(128),
            nn.ReLU(),
            nn.MaxPool2d((2, 1)),
            nn.Dropout(0.3)
        )
        
        self.feature_reduction = nn.Linear(128 * 252, 512)
        
        self.lstm = nn.LSTM(
            input_size=512, hidden_size=128,
            num_layers=2, bidirectional=True,
            batch_first=True, dropout=0.3
        )
        
        self.output_layers = nn.ModuleDict({
            k: nn.Linear(128 * 2, v) for k, v in num_classes_dict.items()
        })
        
        self.crfs = nn.ModuleDict({
            key: ConditionalRandomField(num_tags=num_tags)
            for key, num_tags in num_classes_dict.items()
        })

    def forward(self, x: torch.Tensor, mask: torch.Tensor = None) -> dict:
        """
        모델의 순전파(Forward Pass) 연산을 수행합니다.

        Args:
            x (torch.Tensor): 입력 CQT 스펙트로그램 텐서 (Batch, Freq, Time)
            mask (torch.Tensor, optional): 시퀀스 패딩 마스크 텐서

        Returns:
            dict: 속성별 로짓(Logits) 결과 텐서를 담은 딕셔너리
        """
        x = x.unsqueeze(1)
        x = self.cnn(x)
        x = x.permute(0, 2, 1, 3).contiguous()
        
        cnn_output_feature_dim = x.shape[2] * x.shape[3]
        lstm_sequence_length = x.shape[1]
        x = x.view(x.size(0), lstm_sequence_length, cnn_output_feature_dim)
        
        if x.shape[2] != self.feature_reduction.in_features:
            logger.error(f"CNN feature dim mismatch! Got {x.shape[2]}, expected {self.feature_reduction.in_features}")
            return None
            
        x = self.feature_reduction(x)
        x, _ = self.lstm(x)
        
        logits = {k: layer(x) for k, layer in self.output_layers.items()}
        return logits

    def decode(self, x: torch.Tensor, mask: torch.Tensor) -> dict:
        """
        CRF 비터비(Viterbi) 디코딩을 거쳐 시간적 연속성이 보정된 최적의 코드 시퀀스를 추론합니다.

        Args:
            x (torch.Tensor): 입력 스펙트로그램 텐서
            mask (torch.Tensor): 유효 프레임 마스크 텐서

        Returns:
            dict: 디코딩된 속성별 태그 인덱스 시퀀스 딕셔너리
        """
        logits = self.forward(x)
        if logits is None:
            return None
            
        decoded_sequences = {}
        try:
            lstm_output_seq_len = list(logits.values())[0].shape[1]
        except IndexError:
            return None

        if mask.shape[1] != lstm_output_seq_len:
            mask = mask[:, :lstm_output_seq_len]

        for key in self.output_layers.keys():
            emissions = logits[key]
            try:
                if not isinstance(emissions, torch.Tensor) or emissions.ndim != 3:
                    decoded_sequences[key] = [[] for _ in range(mask.shape[0])]
                    continue
                current_mask = mask
                if mask.shape[0] != emissions.shape[0] or mask.shape[1] != emissions.shape[1]:
                    current_mask = torch.ones_like(emissions[..., 0], dtype=torch.bool)

                viterbi_list = self.crfs[key].viterbi_tags(emissions, mask=current_mask)
                decoded_sequences[key] = [tags for tags, v_score in viterbi_list]
            except Exception as e:
                logger.error(f"CRF decoding error for {key}: {e}", exc_info=True)
                decoded_sequences[key] = [[] for _ in range(mask.shape[0])]
                
        return decoded_sequences


###############################################
# 4. 음악 신호 처리 및 키(Key) 분석 유틸리티
###############################################
def detect_key(y: np.ndarray, sr: int) -> tuple:
    """
    Krumhansl-Schmuckler 프로파일과 오디오의 크로마(Chroma CQT) 벡터 간 상관관계를 분석해 조성(Key)을 판별합니다.

    Args:
        y (np.ndarray): 모노 오디오 타임 라인 파형 데이터
        sr (int): 오디오 샘플링 레이트 (Hz)

    Returns:
        tuple: (조성의 루트 노트 문자열, 모드 문자열 - 'major' 또는 'minor')
    """
    try:
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr, bins_per_octave=BINS_PER_OCTAVE)
        if chroma.shape[1] == 0:
            return 'C', 'major'
            
        chroma_mean = np.mean(chroma, axis=1)
        major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
        minor_profile = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
        
        keys, profiles, note_names = [], [], ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        for i in range(12):
            keys.extend([f"{note_names[i]}:maj", f"{note_names[i]}:min"])
            profiles.extend([np.roll(major_profile, i), np.roll(minor_profile, i)])
            
        correlations = []
        if np.std(chroma_mean) == 0:
            return 'C', 'major'
            
        for profile in profiles:
            valid = ~np.isnan(chroma_mean) & ~np.isnan(profile)
            if np.sum(valid) < 2 or np.std(chroma_mean[valid]) == 0 or np.std(profile[valid]) == 0:
                correlations.append(0.0)
            else:
                corr = np.corrcoef(chroma_mean[valid], profile[valid])[0, 1]
                correlations.append(0.0 if np.isnan(corr) else corr)
                
        max_index = np.argmax(correlations)
        detected_key_str = keys[max_index]
        
        root, mode = ('C', 'major')
        if ':maj' in detected_key_str:
            root, _ = detected_key_str.split(':')
            mode = 'major'
        elif ':min' in detected_key_str:
            root, _ = detected_key_str.split(':')
            mode = 'minor'
            
        return root, mode
    except Exception as e:
        logger.error(f"Key detection failed: {e}", exc_info=True)
        return 'C', 'major'


def build_diatonic_chords(key_root: str = 'C', key_mode: str = 'major') -> Set[str]:
    """
    Music21 라이브러리를 사용하여 주어진 조성(Key)의 스케일에 포함되는 다이어토닉 화음 집합을 빌드합니다.

    Args:
        key_root (str): 조성 루트 음 (예: 'C', 'Am')
        key_mode (str): 조성 모드 ('major' 또는 'minor')

    Returns:
        Set[str]: 다이어토닉 코드 문자열 집합
    """
    diatonic_set = set()
    try:
        k = key.Key(key_root, key_mode)
        scale_pitches = k.getScale().getPitches()
        for degree in range(1, 8):
            try:
                root_p = scale_pitches[degree-1]
                third_p = k.getScale().pitchFromDegree(degree + 2)
                fifth_p = k.getScale().pitchFromDegree(degree + 4)
                if not third_p or not fifth_p:
                    continue
                triad = chord.Chord([root_p, third_p, fifth_p])
                q_full = triad.quality
                
                if 'diminished' in q_full: quality = 'dim'
                elif 'minor' in q_full: quality = 'min'
                elif 'augmented' in q_full: quality = 'aug'
                else: quality = 'maj'
                
                root_name = root_p.name.replace('♭', 'b').replace('♯', '#')
                diatonic_set.add(f"{root_name}:{quality}")
            except Exception:
                pass
    except Exception as e:
        logger.error(f"Build diatonic failed: {e}", exc_info=True)
    return diatonic_set


def load_pretrained_model(path: str, num_classes_dict: dict, device: torch.device) -> nn.Module:
    """
    지정된 경로의 `.pth` 파일로부터 사전 학습된 모델 가중치를 로드하고 평가 모드로 설정합니다.

    Args:
        path (str): 가중치 파일 경로
        num_classes_dict (dict): 출력 레이어 클래스 개수 딕셔너리
        device (torch.device): 연산 장치 (CPU 또는 CUDA/MPS)

    Returns:
        nn.Module: 가중치가 적재된 ChordNetWithCRF 모델 인스턴스
    """
    if not os.path.exists(path):
        raise FileNotFoundError(f"Model weight file not found at: {path}")
    
    model = ChordNetWithCRF(num_classes_dict).to(device)
    try:
        checkpoint = torch.load(path, map_location=device)
        model.load_state_dict(checkpoint)
        model.eval()
        logger.info(f"Successfully loaded pretrained model from {path}")
    except Exception as e:
        logger.error(f"Failed to load model state dict: {e}", exc_info=True)
        raise e
    return model


def extract_cqt_rms(y: np.ndarray, sr: int) -> tuple:
    """
    오디오 신호로부터 CQT(Constant-Q Transform) 스펙트로그램과 RMS 에너지를 추출해 배치 단위로 분할합니다.

    Args:
        y (np.ndarray): 오디오 파형 배열
        sr (int): 샘플링 레이트

    Returns:
        tuple: (가공된 CQT 배치 텐서 형태의 numpy array, RMS 배치 배열)
    """
    try:
        cqt = librosa.cqt(y=y, sr=sr, hop_length=HOP_LENGTH, n_bins=N_BINS, bins_per_octave=BINS_PER_OCTAVE)
        if cqt.shape[1] == 0:
            return np.array([]), np.array([])
            
        cqt_mag = np.abs(cqt).T
        rms = librosa.feature.rms(y=y, frame_length=HOP_LENGTH*2, hop_length=HOP_LENGTH)[0]
        
        target_len = cqt_mag.shape[0]
        if len(rms) < target_len:
            rms = np.pad(rms, (0, target_len - len(rms)), mode='constant')
        elif len(rms) > target_len:
            rms = rms[:target_len]
            
        total_frames = cqt_mag.shape[0]
        remainder = total_frames % FRAMES_PER_SEQ
        if remainder != 0:
            pad_width = FRAMES_PER_SEQ - remainder
            cqt_mag = np.pad(cqt_mag, ((0, pad_width), (0, 0)), mode='constant')
            rms = np.pad(rms, (0, pad_width), mode='constant')
            total_frames += pad_width
            
        num_sequences = total_frames // FRAMES_PER_SEQ
        cqt_batch = np.reshape(cqt_mag, (num_sequences, FRAMES_PER_SEQ, N_BINS))
        rms_batch = np.reshape(rms, (num_sequences, FRAMES_PER_SEQ))
        
        return cqt_batch, rms_batch
    except Exception as e:
        logger.error(f"CQT/RMS extraction failed: {e}", exc_info=True)
        return np.array([]), np.array([])


def decode_detailed_timeline(model, cqt_batch, rms_batch, device) -> List[Dict[str, Any]]:
    """
    모델의 추론 출력을 해석하여 시간 타임스탬프별 코드 라벨과 RMS 세부 지표를 구성합니다.

    Args:
        model (nn.Module): 학습된 코드 인식 모델
        cqt_batch (np.ndarray): CQT 배치 데이터
        rms_batch (np.ndarray): RMS 에너지 배치 데이터
        device (torch.device): 연산 장치

    Returns:
        List[Dict[str, Any]]: 시간 구간별 코드 이벤트 딕셔너리 리스트
    """
    if not isinstance(cqt_batch, np.ndarray) or cqt_batch.size == 0:
        return []
        
    inputs = torch.tensor(cqt_batch, dtype=torch.float32, device=device)
    batch_size = inputs.shape[0]
    
    with torch.no_grad():
        logits = model.forward(inputs)
        if logits is None:
            return []
        lstm_output_seq_len = list(logits.values())[0].shape[1]
        mask = torch.ones(batch_size, lstm_output_seq_len, dtype=torch.bool, device=device)
        decoded_seq = model.decode(inputs, mask)
        if decoded_seq is None:
            return []

    frame_duration = HOP_LENGTH / SR
    seq_duration = FRAMES_PER_SEQ * frame_duration
    detailed_timeline = []
    
    for i in range(batch_size):
        root_seq = decoded_seq.get('Root', [[]]*batch_size)[i]
        if not root_seq:
            continue
        seq_len = len(root_seq)
        
        tri_seq  = decoded_seq.get('Triad', [[]]*batch_size)[i]
        bass_seq = decoded_seq.get('Bass', [[]]*batch_size)[i]
        s7_seq   = decoded_seq.get('7th', [[]]*batch_size)[i]
        s9_seq   = decoded_seq.get('9th', [[]]*batch_size)[i]
        s11_seq  = decoded_seq.get('11th', [[]]*batch_size)[i]
        s13_seq  = decoded_seq.get('13th', [[]]*batch_size)[i]
        
        if not all(len(s) == seq_len for s in [tri_seq, bass_seq, s7_seq, s9_seq, s11_seq, s13_seq]):
            continue
            
        current_step_duration = seq_duration / seq_len if seq_len > 0 else 0
        if current_step_duration == 0:
            continue

        for t_idx in range(seq_len):
            rr = root_map_inv.get(root_seq[t_idx], "N")
            tt = triad_map_inv.get(tri_seq[t_idx], "N")
            bb = bass_map_inv.get(bass_seq[t_idx], "N")
            s7 = _7th_map_inv.get(s7_seq[t_idx], "N")
            s9 = _9th_map_inv.get(s9_seq[t_idx], "N")
            s11 = _11th_map_inv.get(s11_seq[t_idx], "N")
            s13 = _13th_map_inv.get(s13_seq[t_idx], "N")
            
            if rr == 'N' or tt == 'N':
                chord_str = 'N'
            else:
                chord_str = f"{rr}:{tt}"
                if s7 != 'N': chord_str += s7
                if s9 != 'N': chord_str += '9'
                if s11 != 'N': chord_str += '11'
                if s13 != 'N': chord_str += '13'
                if bb != 'N' and bb != rr: chord_str += f"/{bb}"
                
            if chord_str.endswith(':mai'):
                chord_str = chord_str.replace(':mai', ':maj')

            start_time = i * seq_duration + t_idx * current_step_duration
            end_time = start_time + current_step_duration

            frames_per_step = FRAMES_PER_SEQ / seq_len if seq_len > 0 else 0
            start_f = max(0, min(int(round(t_idx * frames_per_step)), FRAMES_PER_SEQ))
            end_f = max(start_f, min(int(round((t_idx + 1) * frames_per_step)), FRAMES_PER_SEQ))
            
            rms_vals = rms_batch[i, start_f:end_f]
            local_rms = float(np.mean(rms_vals)) if rms_vals.size > 0 else 0.0
            
            if end_time <= start_time + 1e-6:
                continue
                
            detailed_timeline.append({
                "start_time": round(start_time, 4),
                "end_time": round(end_time, 4),
                "chord": chord_str,
                "rms": round(local_rms, 4)
            })
            
    return detailed_timeline


###############################################
# 5. 후처리 및 다이어토닉 교정 파이프라인
###############################################
def merge_consecutive_chords(timeline: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    시간 연속성이 유지되는 동일한 코드 이벤트들을 하나로 병합합니다.

    Args:
        timeline (List[Dict[str, Any]]): 원본 코드 타임라인 리스트

    Returns:
        List[Dict[str, Any]]: 병합된 타임라인 리스트
    """
    if not timeline: return []
    merged = [timeline[0].copy()]
    for next_chord in timeline[1:]:
        current_chord = merged[-1]
        time_gap = next_chord['start_time'] - current_chord['end_time']
        if next_chord['chord'] == current_chord['chord'] and time_gap < 0.05:
            current_chord['end_time'] = max(current_chord['end_time'], next_chord['end_time'])
            current_chord['rms'] = next_chord['rms']
        else:
            merged.append(next_chord.copy())
    return merged


def apply_temporal_mode_filter(timeline: List[Dict[str, Any]], window_size: int) -> List[Dict[str, Any]]:
    """
    슬라이딩 윈도우 내의 최빈값(Mode)을 산출하여 짧은 노이즈성 코드 변동을 평탄화합니다.

    Args:
        timeline (List[Dict[str, Any]]): 타임라인 데이터
        window_size (int): 윈도우 크기 (홀수)

    Returns:
        List[Dict[str, Any]]: 스무딩 처리된 타임라인
    """
    if not timeline or window_size < 3 or window_size % 2 == 0:
        return timeline
    chords = [item['chord'] for item in timeline]
    n = len(chords)
    half_window = window_size // 2
    padded = [chords[0]] * half_window + chords + [chords[-1]] * half_window
    smoothed = []
    
    for i in range(n):
        orig = chords[i]
        if orig == 'N':
            smoothed.append('N')
            continue
        window = [c for c in padded[i : i + window_size] if c != 'N']
        if not window:
            smoothed.append(orig)
            continue
        most_common = Counter(window).most_common()
        if len(most_common) == 1 or most_common[0][1] > most_common[1][1]:
            smoothed.append(most_common[0][0])
        else:
            smoothed.append(orig)
            
    new_timeline = [item.copy() for item in timeline]
    for i, item in enumerate(new_timeline):
        item['chord'] = smoothed[i]
    return merge_consecutive_chords(new_timeline)


def apply_min_duration_filter(timeline: List[Dict[str, Any]], min_duration: float) -> List[Dict[str, Any]]:
    """
    최소 지속 시간 기준에 못 미치는 튀는 단발성 코드 이벤트를 필터링합니다.

    Args:
        timeline (List[Dict[str, Any]]): 타임라인 리스트
        min_duration (float): 최소 유지 시간 (초)

    Returns:
        List[Dict[str, Any]]: 필터링된 타임라인
    """
    if not timeline: return []
    merged = merge_consecutive_chords(timeline)
    return [e for e in merged if (e['end_time'] - e['start_time']) >= min_duration or e['chord'] == 'N']


def apply_diatonic_correction(timeline: List[Dict[str, Any]], diatonic_set: Set[str], k: key.Key) -> List[Dict[str, Any]]:
    """
    음악 이론적 조성(Key) 규칙에 기반하여 잘못 인식된 메이저/마이너 코드를 다이어토닉 화음으로 교정합니다.

    Args:
        timeline (List[Dict[str, Any]]): 코드 타임라인
        diatonic_set (Set[str]): 다이어토닉 코드 집합
        k (key.Key): music21 조성 객체

    Returns:
        List[Dict[str, Any]]: 보정 완료된 타임라인
    """
    if not timeline or k is None: return timeline
    corrected = []
    try:
        scale_pitches = k.getScale().getPitches()
        if len(scale_pitches) < 7: return timeline
        
        correction_map = {}
        if k.mode == 'major':
            p3 = scale_pitches[2].name.replace('♭', 'b').replace('♯', '#')
            p6 = scale_pitches[5].name.replace('♭', 'b').replace('♯', '#')
            p7 = scale_pitches[6].name.replace('♭', 'b').replace('♯', '#')
            correction_map = {f"{p3}:maj": f"{p3}:min", f"{p6}:maj": f"{p6}:min", f"{p7}:maj": f"{p7}:dim"}
        elif k.mode == 'minor':
            p1 = scale_pitches[0].name.replace('♭', 'b').replace('♯', '#')
            p4 = scale_pitches[3].name.replace('♭', 'b').replace('♯', '#')
            correction_map = {f"{p1}:maj": f"{p1}:min", f"{p4}:maj": f"{p4}:min"}

        for item in timeline:
            chord_str = item['chord']
            new_chord = chord_str
            if chord_str != 'N' and ':' in chord_str:
                try:
                    root, qual = chord_str.split(':', 1)
                    simple_qual = qual.split('7')[0].split('9')[0].split('(')[0].split('/')[0]
                    simple_chord = f"{root}:{simple_qual}"
                    if simple_chord in correction_map:
                        target_qual = correction_map[simple_chord].split(':')[1]
                        new_chord = f"{root}:{target_qual}{qual[len(simple_qual):]}"
                except ValueError:
                    pass
            new_item = item.copy()
            new_item['chord'] = new_chord
            corrected.append(new_item)
    except Exception as e:
        logger.error(f"Diatonic correction error: {e}")
        return timeline
        
    return merge_consecutive_chords(corrected)


def segment_and_structure_results(y, sr, detailed_timeline, beats_per_measure=DEFAULT_BEATS_PER_MEASURE):
    """
    템포 및 비트 그리드 분석 결과와 타임라인을 매칭하여 마디(Measure) 단위로 구조화된 악보 객체를 생성합니다.

    Args:
        y (np.ndarray): 오디오 신호 배열
        sr (int): 샘플링 레이트
        detailed_timeline (List[Dict[str, Any]]): 정제 전 세부 타임라인
        beats_per_measure (int): 마디당 박자 수 (기본 4박자)

    Returns:
        tuple: (마디 구조 데이터 리스트, 템포(BPM), 조성 루트, 조성 모드)
    """
    measures_data = []
    scalar_tempo = 120.0
    detected_key_root, detected_key_mode = 'C', 'major'
    
    try:
        rms_filtered = [e for e in detailed_timeline if e.get("rms", 1.0) >= MIN_RMS_THRESHOLD and e['chord'] != 'N']
        dur_filtered = apply_min_duration_filter(rms_filtered, MIN_CHORD_DURATION)
        smoothed = apply_temporal_mode_filter(dur_filtered, SMOOTHING_WINDOW_SIZE)
        
        detected_key_root, detected_key_mode = detect_key(y, sr)
        diatonic_set = build_diatonic_chords(detected_key_root, detected_key_mode)
        
        try:
            m21_key = key.Key(detected_key_root, detected_key_mode)
            processed_timeline = apply_diatonic_correction(smoothed, diatonic_set, m21_key)
        except Exception:
            processed_timeline = smoothed

        if not processed_timeline:
            return [], scalar_tempo, detected_key_root, detected_key_mode

        tempo_arr, beat_frames = librosa.beat.beat_track(y=y, sr=sr, hop_length=HOP_LENGTH, tightness=150)
        scalar_tempo = float(tempo_arr[0]) if isinstance(tempo_arr, np.ndarray) and tempo_arr.size > 0 else 120.0
        beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP_LENGTH)

        if scalar_tempo > 0 and len(beat_times) > 0:
            beat_interval = 60.0 / scalar_tempo
            synthetic_beats = np.arange(0.0, librosa.get_duration(y=y, sr=sr), beat_interval)
            beats_grid = synthetic_beats if len(synthetic_beats) > 1 else beat_times
        else:
            beats_grid = beat_times

        if len(beats_grid) < 2:
            return [], scalar_tempo, detected_key_root, detected_key_mode

        measure_boundaries = []
        measure_num = 1
        avg_interval = 60.0 / scalar_tempo

        for i in range(0, len(beats_grid), beats_per_measure):
            if i >= len(beats_grid): break
            mst = beats_grid[i]
            next_idx = i + beats_per_measure
            med = beats_grid[next_idx] if next_idx < len(beats_grid) else beats_grid[-1] + avg_interval
            if med <= mst + 1e-6: continue
            measure_boundaries.append({"measure_number": measure_num, "start_time": mst, "end_time": med})
            measure_num += 1

        for m in measure_boundaries:
            mst, med = m["start_time"], m["end_time"]
            quantized_chords = ['N'] * beats_per_measure
            
            for b_idx in range(beats_per_measure):
                b_time = mst + b_idx * avg_interval
                if b_time >= med - 1e-6: break
                
                active_chord = 'N'
                for evt in reversed(processed_timeline):
                    if evt['start_time'] <= b_time < evt['end_time']:
                        active_chord = evt['chord']
                        break
                quantized_chords[b_idx] = active_chord

            measures_data.append({
                "measure_number": m["measure_number"],
                "start_time": round(mst, 4),
                "end_time": round(med, 4),
                "chords": quantized_chords
            })

        return measures_data, scalar_tempo, detected_key_root, detected_key_mode
    except Exception as e:
        logger.error(f"Error in segment_and_structure: {e}", exc_info=True)
        return [], scalar_tempo, detected_key_root, detected_key_mode


###############################################
# 6. FastAPI 애플리케이션 및 비동기 라우터 엔드포인트
###############################################
app = FastAPI(
    title="AI Chord Tracker API",
    description="Real-time audio chord recognition backend inference engine.",
    version="1.0.0"
)

num_classes_dict = {k: len(v) for k, v in mapping.items()}
device = torch.device("cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu"))

@app.on_event("startup")
async def startup_event():
    """
    [Lifecycle Hook: Startup]
    서버 부팅 시 딥러닝 모델 가중치를 메모리에 선적재(Pre-load)하여 app.state에 등록합니다.
    """
    logger.info(f"Initializing FastAPI server on computation device: {device}")
    try:
        app.state.model = load_pretrained_model(MODEL_PATH, num_classes_dict, device)
        logger.info("Deep learning model successfully loaded into application state.")
    except Exception as e:
        logger.error(f"Critical Error: Failed to load chord model during startup: {e}")
        app.state.model = None


@app.post("/download-audio/")
async def download_audio(request: Request):
    """
    [Endpoint] 유튜브 URL을 전달받아 백그라운드 스레드 풀에서 오디오를 다운로드 및 변환합니다.

    Args:
        request (Request): 클라이언트 JSON 요청 객체 (url 포함)

    Returns:
        JSONResponse: Base64로 인코딩된 WAV 오디오 스트림 데이터
    """
    try:
        data = await request.json()
        url = data.get("url")
        if not url:
            raise HTTPException(status_code=400, detail="YouTube URL is missing.")

        wav_path = os.path.join(DOWNLOAD_DIR, f"audio_temp_{os.getpid()}.wav")
        if os.path.exists(wav_path):
            os.remove(wav_path)

        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': os.path.join(DOWNLOAD_DIR, f"audio_temp_{os.getpid()}.%(ext)s"),
            'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'wav', 'preferredquality': '192'}],
            'quiet': True,
            'no_warnings': True,
            'retries': 3,
            'socket_timeout': 30
        }

        def _blocking_download():
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])

        await asyncio.to_thread(_blocking_download)

        target_wav = None
        for f in os.listdir(DOWNLOAD_DIR):
            if f.startswith(f"audio_temp_{os.getpid()}") and f.endswith(".wav"):
                target_wav = os.path.join(DOWNLOAD_DIR, f)
                break

        if not target_wav or not os.path.exists(target_wav):
            raise HTTPException(status_code=500, detail="Audio conversion to WAV failed.")

        with open(target_wav, "rb") as f:
            encoded_audio = base64.b64encode(f.read()).decode("utf-8")

        os.remove(target_wav)
        return JSONResponse(content={"audio_base64": encoded_audio})

    except Exception as e:
        logger.error(f"Download endpoint error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/chord-recognition/")
async def chord_recognition(file: UploadFile = File(...)):
    """
    [Endpoint] 업로드된 오디오 파일을 비동기 스레드 풀에서 분석하여 코드 악보 구조를 반환합니다.

    Args:
        file (UploadFile): 분석할 오디오 파일 (WAV 등)

    Returns:
        JSONResponse: 템포, 조성, 마디별 코드 배열이 담긴 구조화된 결과 객체
    """
    model = getattr(app.state, "model", None)
    if model is None:
        raise HTTPException(status_code=503, detail="Chord recognition model is not loaded.")

    temp_path = os.path.join(TEMP_UPLOAD_DIR, f"temp_{os.getpid()}_{file.filename}")
    try:
        file_content = await file.read()
        if not file_content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")
            
        with open(temp_path, "wb") as f:
            f.write(file_content)

        def _heavy_audio_processing():
            y, sr_loaded = librosa.load(temp_path, sr=SR, mono=True)
            if len(y) == 0:
                raise ValueError("Loaded audio data is empty.")
            cqt_batch, rms_batch = extract_cqt_rms(y, SR)
            detailed_timeline = decode_detailed_timeline(model, cqt_batch, rms_batch, device)
            measures_data, tempo, key_root, key_mode = segment_and_structure_results(y, SR, detailed_timeline)
            return measures_data, tempo, key_root, key_mode

        measures_data, tempo, key_root, key_mode = await asyncio.to_thread(_heavy_audio_processing)

        response_content = {
            "tempo": round(float(tempo), 2),
            "key_root": key_root,
            "key_mode": key_mode,
            "time_signature_numerator": DEFAULT_BEATS_PER_MEASURE,
            "time_signature_denominator": 4,
            "measures": measures_data
        }
        return JSONResponse(content=response_content)

    except Exception as e:
        logger.error(f"Exception in chord_recognition pipeline: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


@app.get("/")
def root():
    """[Endpoint] API 헬스 체크 및 모델 상태 반환"""
    model_status = "Ready" if getattr(app.state, "model", None) is not None else "Not Loaded"
    return {"message": f"AI Chord Tracker API is running.", "model_status": model_status}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("chordAPI:app", host="0.0.0.0", port=int(os.getenv("PORT_CHORD", 8002)), reload=False)