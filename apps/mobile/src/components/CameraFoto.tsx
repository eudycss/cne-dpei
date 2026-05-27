import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { fontFamily } from '../theme/typography';

interface Props {
  onCapture: (uri: string) => void;
  onCancel: () => void;
}

export function CameraFoto({ onCapture, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [capturedBase64, setCapturedBase64] = useState<string | null>(null);

  if (!permission) {
    return (
      <View style={styles.permissionWrap}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  if (!permission.granted) {
    return (
      <View style={styles.permissionWrap}>
        <Text style={styles.permissionText}>
          Necesitamos acceso a la cámara para tomar la foto del militar.
        </Text>
        {permission.canAskAgain ? (
          <Pressable style={styles.primary} onPress={() => requestPermission()}>
            <Text style={styles.primaryText}>Conceder permiso</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.primary} onPress={() => Linking.openSettings()}>
            <Text style={styles.primaryText}>Abrir ajustes</Text>
          </Pressable>
        )}
        <Pressable style={styles.secondary} onPress={onCancel}>
          <Text style={styles.secondaryText}>Cancelar</Text>
        </Pressable>
      </View>
    );
  }

  async function tomarFoto() {
    if (!cameraRef.current || busy || !cameraReady) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        base64: true,
      });
      if (photo?.uri) {
        setCapturedUri(photo.uri);
        setCapturedBase64(photo.base64 ?? null);
      }
    } finally {
      setBusy(false);
    }
  }

  function repetir() {
    setCapturedUri(null);
    setCapturedBase64(null);
  }

  // Vista de revisión: el usuario ve la foto y decide si la usa o repite.
  // Mantenemos esto dentro del componente para que la pantalla anfitriona reciba
  // solo el URI ya validado por el usuario.
  if (capturedUri) {
    // Preferimos base64 para el preview porque algunos emuladores (Android
    // virtual) renderizan mal el URI del archivo. La subida sigue usando el URI.
    const previewSource = capturedBase64
      ? { uri: `data:image/jpeg;base64,${capturedBase64}` }
      : { uri: capturedUri };
    return (
      <View style={styles.container}>
        <Image source={previewSource} style={StyleSheet.absoluteFill} resizeMode="contain" />
        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={onCancel} style={styles.topBtn}>
            <Text style={styles.topBtnText}>Cancelar</Text>
          </Pressable>
          <Text style={styles.topTitle}>¿Está bien la foto?</Text>
          <View style={styles.topBtn} />
        </View>
        <View style={[styles.reviewBar, { paddingBottom: insets.bottom + 24 }]}>
          <Pressable style={styles.btnRepetir} onPress={repetir}>
            <Text style={styles.btnRepetirText}>Repetir</Text>
          </Pressable>
          <Pressable style={styles.btnUsar} onPress={() => onCapture(capturedUri)}>
            <Text style={styles.btnUsarText}>Usar esta foto</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const shutterDisabled = busy || !cameraReady;

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        onCameraReady={() => setCameraReady(true)}
      />
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={onCancel} style={styles.topBtn}>
          <Text style={styles.topBtnText}>Cancelar</Text>
        </Pressable>
        <Text style={styles.topTitle}>Foto del militar</Text>
        <View style={styles.topBtn} />
      </View>
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 24 }]}>
        {!cameraReady ? (
          <Text style={styles.readyHint}>Iniciando cámara…</Text>
        ) : null}
        <Pressable
          style={[styles.shutter, shutterDisabled && { opacity: 0.4 }]}
          onPress={tomarFoto}
          disabled={shutterDisabled}
        >
          {busy ? <ActivityIndicator color="#1f2937" /> : <View style={styles.shutterInner} />}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  topBtn: { minWidth: 80 },
  topBtnText: { color: '#fff', fontFamily: fontFamily.semiBold, fontSize: 14 },
  topTitle: { color: '#fff', fontFamily: fontFamily.semiBold, fontSize: 14 },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 16,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 4,
    borderColor: '#1f2937',
    backgroundColor: '#fff',
  },
  readyHint: { color: '#fff', fontFamily: fontFamily.medium, fontSize: 12, marginBottom: 10 },
  reviewBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    gap: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  btnRepetir: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
  },
  btnRepetirText: { color: '#fff', fontFamily: fontFamily.semiBold, fontSize: 14 },
  btnUsar: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#2563eb',
    alignItems: 'center',
  },
  btnUsarText: { color: '#fff', fontFamily: fontFamily.semiBold, fontSize: 14 },
  permissionWrap: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 28, gap: 16 },
  permissionText: { color: '#fff', textAlign: 'center', fontFamily: fontFamily.regular, fontSize: 14, lineHeight: 20 },
  primary: { backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 22, borderRadius: 8 },
  primaryText: { color: '#fff', fontFamily: fontFamily.semiBold },
  secondary: { paddingVertical: 10, paddingHorizontal: 22 },
  secondaryText: { color: '#cbd5e1', fontFamily: fontFamily.medium },
});
