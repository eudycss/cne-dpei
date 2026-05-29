// Tipado mínimo de las variables EXPO_PUBLIC_* inyectadas por Expo en runtime.
// El proyecto no incluye @types/node, por eso declaramos `process` aquí.
declare const process: {
  env: {
    EXPO_PUBLIC_API_URL?: string;
    [key: string]: string | undefined;
  };
};
