# 🎸 AI Chord Tracker & Audio Separator

> 딥러닝을 활용한 실시간 오디오 코드 인식 및 악기 트랙 분리 모바일 애플리케이션 (졸업 논문 공식 구현체)

사용자는 음악을 녹음하거나 YouTube URL을 입력하여 곡의 코드를 분석할 수 있으며, 4개의 개별 트랙(보컬, 베이스, 드럼, 기타)으로 분리된 오디오를 믹서 UI를 통해 실시간으로 제어할 수 있습니다.

---

## 🌟 Key Features

- **실시간 코드 분석 (Chord Recognition):** CNN+LSTM+CRF 모델을 통해 오디오의 코드를 정밀하게 추출하고, 다이어토닉 보정(Diatonic Correction) 알고리즘을 적용하여 인식 정확도를 향상시켰습니다.
- **오디오 소스 분리 (Source Separation):** OpenUnmix 모델과 Griffin-Lim 알고리즘을 결합하여 단일 오디오 트랙을 4개의 악기 트랙으로 분리합니다.
- **4-Track Interactive Mixer:** 분리된 오디오를 앱 내 믹서 UI를 통해 개별 볼륨 조절 및 재생 위치 동기화(Sync) 기능을 제공합니다.
- **YouTube 미디어 파싱:** YouTube URL을 입력받아 `yt-dlp`를 활용해 백그라운드에서 오디오를 안전하게 추출하고 분석합니다.

---

## 🏗 System Architecture

- **Frontend:** React Native, React Navigation, `react-native-sound`
- **Backend:** FastAPI, `yt-dlp`, `asyncio` (비동기 처리)
- **Deep Learning & Audio Processing:** PyTorch, Torchaudio, Librosa
- **AI Models:** OpenUnmix (Source Separation), CNN-LSTM-CRF (Chord Estimation)

---

## 🚀 Getting Started

### 1. Backend Setup (FastAPI & PyTorch)

'''bash
# 백엔드 디렉토리 이동
cd backend

# 가상환경 생성 및 활성화
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 의존성 패키지 설치
pip install -r requirements.txt

# 환경변수 파일 설정 (.env 파일 내 PORT 및 설정 값 수정)
cp .env.example .env

# FastAPI 서버 실행 (포트에 맞춰 실행)
uvicorn chordAPI:app --host 0.0.0.0 --port 8002 --reload
uvicorn separation_api:app --host 0.0.0.0 --port 8000 --reload
'''

### 2. Frontend Setup (React Native)

'''bash
# 프론트엔드 디렉토리 이동
cd frontend

# 패키지 설치
npm install

# 애플리케이션 실행
npx react-native run-android 
# 또는 npx react-native run-ios
'''
## 🎬 Demo & Features (시연 영상)

프로젝트의 핵심 기능인 악기 분리와 음원 검색 및 악보 생성 시연 영상입니다. 이미지를 클릭하시면 유튜브 영상으로 이동합니다.

1️⃣ 악기 분리 기능 (OpenUnmix & Wiener Filter)
2️⃣ 음원 검색 및 AI 코드 악보 생성 기능 (CNN-LSTM-CRF)
