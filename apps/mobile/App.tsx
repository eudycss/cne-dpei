import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
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
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { LoginScreen } from './src/screens/LoginScreen';
import { ChangePasswordScreen } from './src/screens/ChangePasswordScreen';
import { PlaceholderHome } from './src/screens/PlaceholderHome';
import { SalidaDpiScreen } from './src/screens/SalidaDpiScreen';
import { EnTransitoScreen } from './src/screens/EnTransitoScreen';

export type RootStackParamList = {
  Login: undefined;
  ChangePassword: undefined;
  Home: undefined;
  SalidaDpi: undefined;
  EnTransito: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function OperadorFlow() {
  // HU2: el operador empieza en SalidaDpi; al registrar (o si ya registró antes)
  // pasa a EnTransito. Las pantallas posteriores de HU3+ se agregarán en su fase.
  const [salidaRegistrada, setSalidaRegistrada] = useState(false);
  return salidaRegistrada ? (
    <EnTransitoScreen />
  ) : (
    <SalidaDpiScreen onSalidaRegistrada={() => setSalidaRegistrada(true)} />
  );
}

function Navigator() {
  const { user, restoring } = useAuth();

  if (restoring) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  const esOperador = user?.roles.includes('OPERADOR_CDA') ?? false;

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!user ? (
        <Stack.Screen name="Login" component={LoginScreen} />
      ) : user.debeCambiarPwd ? (
        <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
      ) : esOperador ? (
        <Stack.Screen name="Home" component={OperadorFlow} />
      ) : (
        <Stack.Screen name="Home" component={PlaceholderHome} />
      )}
    </Stack.Navigator>
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
    <AuthProvider>
      <StatusBar style="auto" />
      <NavigationContainer>
        <Navigator />
      </NavigationContainer>
    </AuthProvider>
  );
}
