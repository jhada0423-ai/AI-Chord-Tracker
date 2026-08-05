


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

## 📖 thesis
본 논문은 악기 연주 초심자의 효율적인 자기주도적 연습을 지원하기 위해 실시간 음악 인식, 자동 코드 악보 생성, 그리고 악기별 음원 분리 기술을 통합한 지능형 음악분석시스템을 제안한다. 기존의 악보 확보 과정에서 발생하는 높은 비용과 복잡한 절차, 특히 곡 정보 부재 시 초심자들이 겪는 연습의 진입 장벽을 해소하는 데 연구의 주안점을 두었다. 제안 시스템은 ACRCloud를 활용하여 주변 환경의 음악을 실시간으로 식별하고, 식별된 음원이나 사용자가 제공한 YouTube URL로부터 딥러닝 기반의 화성 분석을 수행하여 정밀한 코드 악보를 자동 생성한다. 또한, Open-Unmix 모델 기반의 음원 분리 기술을 적용하여 보컬, 드럼, 베이스 등 개별 트랙을 독립적으로 제어함으로써 사용자가 특정 파트에 집중할 수 있는 맞춤형 연습 환경을 구축하였다. 본 시스템은 FastAPI 기반 서버와 React Native 기반 클라이언트를 결합한 크로스 플랫폼 아키텍처로 구현되었으며, 실험 결과 다양한 소음 환경에서도 안정적인 인식 정확도와 실시간 처리에 적합한 성능을 입증하였다. 본 연구는 딥러닝 기술을 초심자 중심의 통합 솔루션으로 최적화함으로써 악기 연습의 지속성을 높이고 아마추어 음악 학습 생태계의 접근성을 극대화하는 데 기여할 것으로 기대된다.
#악기 연습 #음악 인식 #코드 악보 #음원 분리 #지능형 음악분석시스템 #딥러닝 #Instrument practice #Music recognition #Chord sheet #Audio separation #Intelligent Music Analysis System #Deep learning
[초심 악기 연주자들을 위한 딥러닝 기반 지능형 음악분석시스템.pdf](https://github.com/user-attachments/files/30731126/default.pdf)

## 🚀 Getting Started

### 1. Backend Setup (FastAPI & PyTorch)

```bash
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
```

### 2. Frontend Setup (React Native)

```bash
# 프론트엔드 디렉토리 이동
cd frontend

# 패키지 설치
npm install

# 애플리케이션 실행
npx react-native run-android 
# 또는 npx react-native run-ios
```
## 🎬 Demo & Features (시연 영상)

프로젝트의 핵심 기능인 악기 분리와 음원 검색 및 악보 생성 시연 영상입니다. 이미지를 클릭하시면 유튜브 영상으로 이동합니다.

### 1️⃣ 악기 분리 기능 (OpenUnmix & Wiener Filter)
[![Instrument Separation Demo](https://img.youtube.com/vi/2gFNF1ZLtwc/0.jpg)](https://youtu.be/2gFNF1ZLtwc)

### 2️⃣ 음원 검색 및 AI 코드 악보 생성 기능 (CNN-LSTM-CRF)
[![Chord Recognition Demo](https://img.youtube.com/vi/67iMyjjpC7w/0.jpg)](https://youtu.be/67iMyjjpC7w)
