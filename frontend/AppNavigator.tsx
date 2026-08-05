import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import App from './App'; // 메인 화면
import AppYouTubeMusicScreen from './AppYouTubeMusicScreen'; // ACR 결과 화면
import AppChordRecognition from './AppChordRecognition'; // 코드 인식 결과 화면

// 악기 분리 결과 재생 화면 임포트 (InstrumentMixerScreen만 필요)
// SeparationInputScreen은 이제 사용하지 않으므로 임포트 제거
import InstrumentMixerScreen from './InstrumentMixerScreen';


// 네비게이션 스택 타입 정의 (SeparationInput 제거)
type RootStackParamList = {
  Home: undefined;
  AppYouTubeMusicScreen: {
    title: string; artist: string; album: string; acrYouTubeVideoId?: string;
  };
  AppChordRecognition: {
    url: string;
    audioPath: string;
    apiResponse: any; // API 응답 타입에 맞게 조정
  };
  // 악기 분리 관련 화면 타입 (InstrumentMixer만 남음)
  // SeparationInput: undefined; // 제거
  InstrumentMixer: { // Mixer 화면은 분리된 오디오 파일 URL 목록을 받음
    vocalsUrl: string;
    drumsUrl: string;
    bassUrl: string;
    otherUrl: string;
    // 필요한 경우 다른 악기 URL 추가
  };
};


const Stack = createStackNavigator<RootStackParamList>(); // Stack 네비게이터에 타입 적용

const AppNavigator = () => (
  <NavigationContainer>
    <Stack.Navigator initialRouteName="Home">
      {/* 홈 화면 */}
      <Stack.Screen
        name="Home"
        component={App}
        options={{ headerShown: false }} // 헤더 숨기기
      />

      {/* YouTube Music 결과 화면 (기존) */}
      <Stack.Screen
        name="AppYouTubeMusicScreen"
        component={AppYouTubeMusicScreen}
        options={{ title: '음악 찾기 결과' }} // 사용자 정의 헤더 제목
      />

      {/* Chord Recognition 화면 (기존) */}
      <Stack.Screen
        name="AppChordRecognition"
        component={AppChordRecognition}
        options={{ title: '코드 악보 결과' }} // 헤더 제목 추가
      />

      {/* --- 악기 분리 결과 화면 (InstrumentMixer만 남음) --- */}
      {/* SeparationInput 화면 정의는 제거됩니다. */}
      <Stack.Screen
        name="InstrumentMixer" // 네비게이터 이름
        component={InstrumentMixerScreen}
        options={{ title: '악기 분리 재생기' }} // 헤더 제목
      />
      {/* ------------------------------------ */}

    </Stack.Navigator>
  </NavigationContainer>
);

export default AppNavigator;