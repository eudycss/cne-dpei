import { useEffect, useRef, useState } from 'react';
import { Animated, StyleProp, TextStyle, View } from 'react-native';

interface Props {
  text: string;
  style?: StyleProp<TextStyle>;
}

// ponytail: roll de 2 estados con Animated del core de RN (sin react-native-reanimated).
// Suficiente para el botón de login; subir a reanimated solo si se necesita algo más complejo.
export function SlotText({ text, style }: Props) {
  const [displayed, setDisplayed] = useState(text);
  const [next, setNext] = useState<string | null>(null);
  const [h, setH] = useState(0);
  const y = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (text === displayed || next !== null || h === 0) return;
    setNext(text);
    Animated.timing(y, { toValue: -h, duration: 250, useNativeDriver: true }).start(() => {
      setDisplayed(text);
      setNext(null);
      y.setValue(0);
    });
  }, [text, displayed, next, h, y]);

  return (
    <View style={{ height: h || undefined, overflow: 'hidden' }}>
      <Animated.View style={{ transform: [{ translateY: y }] }}>
        <Animated.Text
          style={style}
          onLayout={(e) => h === 0 && setH(e.nativeEvent.layout.height)}
        >
          {displayed}
        </Animated.Text>
        <Animated.Text style={style}>{next ?? ''}</Animated.Text>
      </Animated.View>
    </View>
  );
}
