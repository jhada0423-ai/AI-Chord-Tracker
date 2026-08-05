#!/usr/init/env python3
# -*- coding: utf-8 -*-

"""
===================================================================================
Project Name : AI-Chord-Tracker (Backend - Instrument Separation API)
Description  : 
    - OpenUnmix 기반 딥러닝 모델 및 EM 위너 필터(Wiener Filter) 엔진을 호출하여 
      유튜브 음원을 4개 트랙(Vocal, Drums, Bass, Other)으로 정밀 분리하는 FastAPI 서버입니다.
    - 무거운 다운로드 및 GPU/CPU 추론 연산을 비동기 스레드 풀(`asyncio.to_thread`)로 
      오프로딩하여 고并发(Concurrency) 환경에서 서버 블로킹을 방지합니다.
    - 정적 파일 라우팅을 통해 분리된 오디오 파일에 대한 스트리밍 접근을 지원합니다.

Author       : Jang Dong-il
===================================================================================
"""

import os
import sys
import uuid
import logging
import subprocess
import asyncio
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

# --- 0. 환경변수 로드 및 글로벌 로깅 포맷 설정 ---
load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s (PID:%(process)d): %(message)s"
)
logger = logging.getLogger("SeparationAPI-Engine")

# --- 1. 핵심 모듈(separation_core) 임포트 무결성 검사 ---
try:
    from separation_core import separate_instruments_process, initialize_separator, device, check_model_paths
except ImportError as e:
    logger.error(f"Failed to import separation_core module: {e}")
    logger.error("Please ensure separation_core.py is located in the same directory.")
    sys.exit(1)

# --- 2. 환경변수 기반 설정 (하드코딩 완전 제거) ---
INPUT_DIR = os.getenv("INPUT_DIR", "./downloads")
OUTPUT_DIR = os.getenv("OUTPUT_DIR", "./separateaudio")
PUBLIC_URL = os.getenv("PUBLIC_URL", "http://localhost:8000")

# 필수 입출력 디렉토리 자동 생성 무결성 보장
os.makedirs(INPUT_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

logger.info(f"Input Directory Path : {INPUT_DIR}")
logger.info(f"Output Directory Path: {OUTPUT_DIR}")
logger.info(f"Public Access Base URL: {PUBLIC_URL}")


# --- 3. FastAPI 애플리케이션 초기화 ---
app = FastAPI(
    title="Instrument Separation API",
    description="Backend audio source separation inference engine using OpenUnmix & EM Wiener Filter.",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# [Static File Serving] 분리된 오디오 WAV 파일들을 외부에서 URL로 직접 접근할 수 있도록 마운트
if not os.path.exists(OUTPUT_DIR):
    logger.error(f"Output directory missing at startup: {OUTPUT_DIR}")

app.mount("/output", StaticFiles(directory=OUTPUT_DIR), name="output")
logger.info("Static file routing successfully mounted at '/output'.")


# --- 4. 요청 데이터 유효성 검증용 Pydantic 모델 ---
class YouTubeURLRequest(BaseModel):
    """클라이언트로부터 전달받는 유튜브 소스 요청 바디 스키마"""
    youtube_url: str


# Separator 모델 인스턴스 전역 관리 변수 (서버 구동 시점에 메모리 로드)
separator_instance: Optional[object] = None


@app.on_event("startup")
async def startup_event():
    """
    [Lifecycle Hook: Startup]
    서버 구동 시점에 OpenUnmix 4개 악기 모델 가중치 경로를 검증하고, 
    EM 위너 필터 기반 Separator를 메모리에 선적재(Pre-load)하여 첫 요청 지연을 방지합니다.
    """
    global separator_instance
    logger.info("FastAPI startup event triggered. Initializing Wiener Separator...")

    if not check_model_paths():
        logger.error("Model path validation failed. Aborting Separator initialization.")
        separator_instance = None
    else:
        try:
            separator_instance = await asyncio.to_thread(initialize_separator)
            if separator_instance:
                logger.info("Wiener Separator model initialized successfully and ready for inference.")
            else:
                logger.error("Separator model initialization returned None.")
        except Exception as e:
            logger.error(f"Critical Error during Separator startup initialization: {e}", exc_info=True)
            separator_instance = None


@app.post("/separate")
async def process_youtube_for_separation(req: YouTubeURLRequest):
    """
    [Endpoint] 유튜브 URL을 기반으로 음원을 다운로드한 뒤 EM 위너 필터 기반 악기 소스 분리를 수행합니다.

    Args:
        req (YouTubeURLRequest): 유튜브 링크가 포함된 요청 바디 객체

    Returns:
        dict: 분리 완료 메시지와 각 트랙별 접근 가능한 스트리밍 URL 딕셔너리
    """
    youtube_url = req.youtube_url
    logger.info(f"Received separation request for target URL: {youtube_url}")

    global separator_instance
    if separator_instance is None:
        logger.error("Separation model is not available or failed to load during startup.")
        raise HTTPException(
            status_code=503, 
            detail="악기 분리 서비스 준비 중: 딥러닝 모델이 로드되지 않았습니다."
        )

    file_id = str(uuid.uuid4())
    input_temp_template = os.path.join(INPUT_DIR, f"{file_id}.%(ext)s")
    actual_wav_path: Optional[str] = None

    try:
        python_executable = sys.executable
        command = [
            python_executable, "-m", "yt_dlp",
            "-x",
            "--audio-format", "wav",
            "-o", input_temp_template,
            "--no-warnings",
            "--quiet",
            "--retries", "3",
            "--socket-timeout", "60",
            youtube_url
        ]

        logger.info("Spawning subprocess for yt-dlp audio extraction...")

        def _run_ytdlp():
            return subprocess.run(command, check=True, capture_output=True, text=True, timeout=600)

        await asyncio.to_thread(_run_ytdlp)

        found_files = [f for f in os.listdir(INPUT_DIR) if f.startswith(file_id) and f.endswith('.wav')]
        if found_files:
            actual_wav_path = os.path.join(INPUT_DIR, found_files[0])
            logger.info(f"Target WAV file secured: {actual_wav_path}")
        else:
            raise FileNotFoundError(f"WAV file corresponding to ID {file_id} could not be found.")

    except subprocess.CalledProcessError as e:
        logger.error(f"yt-dlp execution failed. Stderr: {e.stderr}")
        raise HTTPException(status_code=500, detail=f"유튜브 다운로드 실패: {e.stderr.strip()}")
    except subprocess.TimeoutExpired:
        logger.error("yt-dlp execution timed out (exceeded 600 seconds).")
        raise HTTPException(status_code=500, detail="유튜브 다운로드 시간 초과 (10분 초과)")
    except Exception as e:
        logger.error(f"Unexpected error during download phase: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"유튜브 처리 중 오류 발생: {str(e)}")

    output_files_paths = {}
    if actual_wav_path and os.path.exists(actual_wav_path):
        try:
            logger.info(f"Starting heavy EM Wiener separation inference on: {actual_wav_path}")

            def _run_separation():
                return separate_instruments_process(actual_wav_path, OUTPUT_DIR, separator_instance)

            output_files_paths = await asyncio.to_thread(_run_separation)
            logger.info("EM Wiener instrument separation inference successfully completed.")

        except Exception as e:
            logger.error(f"Error during separation inference: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"악기 분리 연산 실패: {str(e)}")
        finally:
            if os.path.exists(actual_wav_path):
                try:
                    os.remove(actual_wav_path)
                    logger.info(f"Cleaned up input temporary WAV: {actual_wav_path}")
                except OSError as cleanup_err:
                    logger.warning(f"Failed to remove input file: {cleanup_err}")
    else:
        raise HTTPException(status_code=500, detail="분리할 유효한 오디오 소스가 존재하지 않습니다.")

    if not output_files_paths:
        logger.error("Separation finished but returned zero output paths.")
        raise HTTPException(status_code=500, detail="분리된 결과 파일이 생성되지 않았습니다.")

    outputs_with_url = {
        name: f"{PUBLIC_URL}/output/{os.path.basename(path)}"
        for name, path in output_files_paths.items()
    }
    logger.info(f"Generated public stream URLs for tracks: {list(outputs_with_url.keys())}")

    return {
        "message": "악기 분리가 완료되었습니다.",
        "outputs": outputs_with_url
    }


@app.get("/")
def read_root():
    """[Endpoint] API 서버 가동 상태 및 딥러닝 모델 준비 상태 확인"""
    model_status = "Ready" if separator_instance is not None else "Not Loaded"
    return {
        "message": "Instrument Separation API is running.",
        "model_status": model_status
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "separation_api:app", 
        host="0.0.0.0", 
        port=int(os.getenv("PORT_SEPARATION", 8000)), 
        reload=False
    )