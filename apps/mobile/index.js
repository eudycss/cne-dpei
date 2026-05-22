import { registerRootComponent } from 'expo';
import App from './App';

// Entry point propio (en lugar de expo/AppEntry) para que Metro resuelva
// correctamente la app en un monorepo pnpm.
registerRootComponent(App);
