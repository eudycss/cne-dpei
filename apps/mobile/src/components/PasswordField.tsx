import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fontFamily } from '../theme/typography';

interface PasswordFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function PasswordField({ value, onChange, placeholder }: PasswordFieldProps) {
  const [show, setShow] = useState(false);

  return (
    <View style={styles.wrapper}>
      <TextInput
        style={styles.input}
        secureTextEntry={!show}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
      />
      <Pressable
        onPress={() => setShow((s) => !s)}
        style={styles.toggle}
        hitSlop={8}
        accessibilityLabel={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
      >
        <Ionicons
          name={show ? 'eye-off-outline' : 'eye-outline'}
          size={20}
          color="#6b7280"
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'relative', marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    padding: 10,
    borderRadius: 6,
    fontSize: 14,
    fontFamily: fontFamily.regular,
    paddingRight: 38,
  },
  toggle: {
    position: 'absolute',
    right: 10,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
});
