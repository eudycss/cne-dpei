import { useRef, useState } from 'react';
import {
  ActivityIndicator,
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
  onScan: (code: string) => void;
  onCancel: () => void;
}

export function CameraQr({ onScan, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const lockRef = useRef(false);
  const [hint, setHint] = useState('Apunta al código QR del kit');

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
          Necesitamos acceso a la cámara para escanear los códigos QR de los kits.
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

  function handleScan(result: { data: string }) {
    if (lockRef.current) return;
    lockRef.current = true;
    setHint('Código detectado…');
    onScan(result.data);
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={handleScan}
      />
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={onCancel} style={styles.topBtn}>
          <Text style={styles.topBtnText}>Cancelar</Text>
        </Pressable>
        <Text style={styles.topTitle}>Escanear Kit Electoral</Text>
        <View style={styles.topBtn} />
      </View>
      <View style={styles.reticleWrap} pointerEvents="none">
        <View style={styles.reticle} />
      </View>
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <Text style={styles.hint}>{hint}</Text>
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
  reticleWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  reticle: {
    width: 240,
    height: 240,
    borderRadius: 14,
    borderWidth: 3,
    borderColor: '#2563eb',
    backgroundColor: 'transparent',
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  hint: { color: '#fff', fontFamily: fontFamily.medium, fontSize: 14, textAlign: 'center' },
  permissionWrap: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 28, gap: 16 },
  permissionText: { color: '#fff', textAlign: 'center', fontFamily: fontFamily.regular, fontSize: 14, lineHeight: 20 },
  primary: { backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 22, borderRadius: 8 },
  primaryText: { color: '#fff', fontFamily: fontFamily.semiBold },
  secondary: { paddingVertical: 10, paddingHorizontal: 22 },
  secondaryText: { color: '#cbd5e1', fontFamily: fontFamily.medium },
});
