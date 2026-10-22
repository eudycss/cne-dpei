import appJson from '../../app.json';

// La foto del militar y las actas usan expo-camera: si el manifiesto pierde
// android.permission.CAMERA, Android ni siquiera muestra el diálogo y el
// operador queda bloqueado en campo (pasó con las APK del 16 y 19-oct).
type Plugin = string | [string, Record<string, unknown>?];
const plugins = appJson.expo.plugins as Plugin[];
const opcionesDe = (nombre: string) => {
  const p = plugins.find((x) => (Array.isArray(x) ? x[0] : x) === nombre);
  return Array.isArray(p) ? (p[1] ?? {}) : {};
};

describe('app.json — permiso de cámara en Android', () => {
  it('pide CAMERA', () => {
    expect(appJson.expo.android.permissions).toContain('android.permission.CAMERA');
  });

  it.each(['expo-image-picker', 'expo-camera'])(
    '%s describe el uso de la cámara (cameraPermission: false lo quita del manifiesto)',
    (plugin) => {
      const texto = opcionesDe(plugin).cameraPermission;
      expect(typeof texto).toBe('string');
      expect((texto as string).trim()).not.toBe('');
    },
  );

  it('android no bloquea CAMERA', () => {
    const bloqueados = (appJson.expo.android as { blockedPermissions?: string[] }).blockedPermissions ?? [];
    expect(bloqueados).not.toContain('android.permission.CAMERA');
  });
});
