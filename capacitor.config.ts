import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.hconnect.android',
  appName: 'hConnect',
  webDir: 'build',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    },
    GoogleAuth: {
      scopes: ['profile', 'email'],
      serverClientId: '118576002113-tqhit7o1ik6huoho1udbv7j71p4843nk.apps.googleusercontent.com',
      forceCodeForRefreshToken: true
    }
  }
};

export default config;
