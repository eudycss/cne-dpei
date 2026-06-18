import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import {
  DMSans_400Regular,
  DMSans_400Regular_Italic,
  DMSans_500Medium,
  DMSans_500Medium_Italic,
  DMSans_600SemiBold,
  DMSans_600SemiBold_Italic,
  DMSans_700Bold,
  DMSans_700Bold_Italic,
} from '@expo-google-fonts/dm-sans';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { LoginScreen } from './src/screens/LoginScreen';
import { ChangePasswordScreen } from './src/screens/ChangePasswordScreen';
import { PlaceholderHome } from './src/screens/PlaceholderHome';
import { SalidaDpiScreen } from './src/screens/SalidaDpiScreen';
import { EnTransitoScreen } from './src/screens/EnTransitoScreen';
import { LlegadaRecintoScreen } from './src/screens/LlegadaRecintoScreen';
import { SalidaRecintoScreen } from './src/screens/SalidaRecintoScreen';
import { EnRetornoScreen } from './src/screens/EnRetornoScreen';
import { LlegadaDpiScreen } from './src/screens/LlegadaDpiScreen';
import { RetornadoScreen } from './src/screens/RetornadoScreen';
import { SupervisorFlow } from './src/screens/SupervisorFlow';
import { getMiAsignacion } from './src/lib/queries/tracking';
// Efecto de import: registra la tarea de rastreo (TaskManager.defineTask) al
// arrancar la app, para que el rastreo en segundo plano (HU4-CA3) se reanude
// tras un reinicio en frío aunque no se monte SalidaRecintoScreen.
import './src/lib/location';

export type RootStackParamList = {
  Login: undefined;
  ChangePassword: undefined;
  Home: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

type OperadorEtapa =
  | 'SALIDA'
  | 'EN_TRANSITO'
  | 'LLEGADA'
  | 'EN_RECINTO'
  | 'EN_RETORNO'
  | 'LLEGADA_DPI'
  | 'RETORNADO';

function OperadorFlow() {
  // HU2 → HU5: el operador transita por estados durante la jornada electoral.
  // Al iniciar consultamos mi-asignacion para arrancar en la etapa correcta;
  // si el operador cerró la app y la vuelve a abrir no retrocede.
  const { colors } = useTheme();
  const [etapa, setEtapa] = useState<OperadorEtapa | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await getMiAsignacion();
        if (data.yaRegistroLlegadaDpi) setEtapa('RETORNADO');
        else if (data.yaRegistroSalidaRecinto) setEtapa('EN_RETORNO');
        else if (data.yaRegistroLlegada) setEtapa('EN_RECINTO');
        else if (data.yaRegistroSalida) setEtapa('EN_TRANSITO');
        else setEtapa('SALIDA');
      } catch {
        // Si falla la carga inicial, SalidaDpiScreen mostrará el error con reintento
        setEtapa('SALIDA');
      }
    })();
  }, []);

  if (etapa === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgPage }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (etapa === 'RETORNADO') return <RetornadoScreen />;
  if (etapa === 'LLEGADA_DPI') {
    return <LlegadaDpiScreen onLlegadaRegistrada={() => setEtapa('RETORNADO')} />;
  }
  if (etapa === 'EN_RETORNO') {
    return <EnRetornoScreen onMarcarLlegada={() => setEtapa('LLEGADA_DPI')} />;
  }
  if (etapa === 'EN_RECINTO') {
    return <SalidaRecintoScreen onSalidaRegistrada={() => setEtapa('EN_RETORNO')} />;
  }
  if (etapa === 'LLEGADA') {
    return <LlegadaRecintoScreen onLlegadaRegistrada={() => setEtapa('EN_RECINTO')} />;
  }
  if (etapa === 'EN_TRANSITO') {
    return <EnTransitoScreen onMarcarLlegada={() => setEtapa('LLEGADA')} />;
  }
  return <SalidaDpiScreen onSalidaRegistrada={() => setEtapa('EN_TRANSITO')} />;
}

function Navigator() {
  const { user, restoring } = useAuth();
  const { colors } = useTheme();

  if (restoring) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgPage }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const esOperador = user?.roles.includes('OPERADOR_CDA') ?? false;
  const esSupervisor = user?.roles.includes('TECNICO_SUPERVISOR') ?? false;

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!user ? (
        <Stack.Screen name="Login" component={LoginScreen} />
      ) : user.debeCambiarPwd ? (
        <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
      ) : esOperador ? (
        <Stack.Screen name="Home" component={OperadorFlow} />
      ) : esSupervisor ? (
        <Stack.Screen name="Home" component={SupervisorFlow} />
      ) : (
        <Stack.Screen name="Home" component={PlaceholderHome} />
      )}
    </Stack.Navigator>
  );
}

function ThemedApp() {
  const { theme } = useTheme();
  return (
    <>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <NavigationContainer>
        <Navigator />
      </NavigationContainer>
    </>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_400Regular_Italic,
    DMSans_500Medium,
    DMSans_500Medium_Italic,
    DMSans_600SemiBold,
    DMSans_600SemiBold_Italic,
    DMSans_700Bold,
    DMSans_700Bold_Italic,
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1e293b' }}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <ThemedApp />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
