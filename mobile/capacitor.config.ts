import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'top.mathmover.mobile',
  appName: 'MathMover Mobile',
  webDir: 'www',
  server: {
    androidScheme: 'https',
  },
};

export default config;
