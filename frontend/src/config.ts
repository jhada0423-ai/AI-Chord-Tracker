// frontend/config.ts

// 개발 환경(Local)과 실서버(Production) 환경에 따라 동적으로 주소 변경
const ENV = {
  development: {
    CHORD_API_URL: 'http://localhost:8002',
    SEPARATION_API_URL: 'http://localhost:8000',
  },
  production: {
    CHORD_API_URL: 'https://your-production-chord-api.com',
    SEPARATION_API_URL: 'https://your-production-separation-api.com',
  },
};

// 현재 환경 설정 (필요에 따라 변경)
const currentEnv = ENV.development;

export const CHORD_API_URL = currentEnv.CHORD_API_URL;
export const SEPARATION_API_URL = currentEnv.SEPARATION_API_URL;