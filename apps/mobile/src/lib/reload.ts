import * as Updates from 'expo-updates';
import { DevSettings } from 'react-native';

export async function reiniciarApp() {
  if (Updates.isEnabled) {
    await Updates.reloadAsync();
  } else {
    DevSettings.reload();
  }
}
