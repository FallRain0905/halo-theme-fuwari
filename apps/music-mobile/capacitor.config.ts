import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "top.fallrain.music",
  appName: "FallRain Music",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
