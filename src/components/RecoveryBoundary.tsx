import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

type RecoveryBoundaryProps = { children: ReactNode; scope?: 'app' | 'map' | 'guidance' };
type RecoveryBoundaryState = { error: Error | null; retryKey: number };

const COPY = {
  app: { eyebrow: 'NAVDIRET PAUSED', title: 'Navigation needs a reset', body: 'Your saved places and trips remain on this device. Reload the navigation screen to continue.', action: 'RELOAD NAVIGATION' },
  map: { eyebrow: 'MAP TEMPORARILY UNAVAILABLE', title: 'Your location is still safe', body: 'The map view could not be drawn. Reload it to try again.', action: 'RELOAD MAP' },
  guidance: { eyebrow: 'GUIDANCE CARD PAUSED', title: 'Route details need a reset', body: 'Your current position and saved route remain available.', action: 'RELOAD GUIDANCE' },
} as const;

export class RecoveryBoundary extends Component<RecoveryBoundaryProps, RecoveryBoundaryState> {
  state: RecoveryBoundaryState = { error: null, retryKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<RecoveryBoundaryState> { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[NavDiret ${this.props.scope ?? 'app'} boundary]`, error, info.componentStack);
  }

  private retry = () => this.setState((state) => ({ error: null, retryKey: state.retryKey + 1 }));

  render() {
    const { error, retryKey } = this.state;
    const scope = this.props.scope ?? 'app';
    if (!error) return <View key={retryKey} style={scope === 'map' ? styles.mapSlot : styles.contentSlot}>{this.props.children}</View>;

    const copy = COPY[scope];
    if (scope === 'map') return (
      <View style={styles.mapFallback}>
        <View style={styles.mapFallbackOrb}><Text style={styles.mapFallbackGlyph}>⌖</Text></View>
        <Text style={styles.mapEyebrow}>{copy.eyebrow}</Text><Text style={styles.mapTitle}>{copy.title}</Text>
        <Text style={styles.mapBody}>{copy.body}</Text>
        <Pressable accessibilityRole="button" onPress={this.retry} style={({ pressed }) => [styles.mapAction, pressed && styles.pressed]}><Text style={styles.mapActionText}>{copy.action}</Text></Pressable>
      </View>
    );
    if (scope === 'guidance') return (
      <View style={styles.guidanceFallback}>
        <Text style={styles.eyebrow}>{copy.eyebrow}</Text><Text style={styles.title}>{copy.title}</Text><Text style={styles.body}>{copy.body}</Text>
        <Pressable accessibilityRole="button" onPress={this.retry} style={({ pressed }) => [styles.action, pressed && styles.pressed]}><Text style={styles.actionText}>{copy.action}</Text></Pressable>
      </View>
    );
    return (
      <SafeAreaView style={styles.appFallback}>
        <View style={styles.appCard}>
          <View style={styles.brandMark}><Text style={styles.brandGlyph}>↗</Text></View>
          <Text style={styles.eyebrow}>{copy.eyebrow}</Text><Text accessibilityRole="header" style={styles.appTitle}>{copy.title}</Text>
          <Text style={styles.body}>{copy.body}</Text>
          <Pressable accessibilityRole="button" onPress={this.retry} style={({ pressed }) => [styles.appAction, pressed && styles.pressed]}><Text style={styles.appActionText}>{copy.action}</Text></Pressable>
        </View>
      </SafeAreaView>
    );
  }
}

const styles = StyleSheet.create({
  appFallback: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#09131B' },
  appCard: { alignItems: 'flex-start', padding: 25, borderRadius: 28, backgroundColor: '#101E28', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  brandMark: { width: 48, height: 48, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginBottom: 28, backgroundColor: '#72E5D1' },
  brandGlyph: { color: '#0C3032', fontSize: 32, fontWeight: '800' },
  eyebrow: { color: '#72E5D1', fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  appTitle: { color: '#F5F8F7', fontSize: 25, lineHeight: 31, fontWeight: '800', marginTop: 9 },
  title: { color: '#F5F8F7', fontSize: 18, lineHeight: 24, fontWeight: '800', marginTop: 5 },
  body: { color: '#A5B4B9', fontSize: 13, lineHeight: 20, marginTop: 10 },
  appAction: { minHeight: 52, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', marginTop: 25, borderRadius: 16, backgroundColor: '#72E5D1' },
  appActionText: { color: '#0C3032', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  contentSlot: { flex: 1 },
  mapSlot: { ...StyleSheet.absoluteFill },
  mapFallback: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34, backgroundColor: '#E3EBE4' },
  mapFallbackOrb: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: 'rgba(40,174,158,0.13)', borderWidth: 1, borderColor: 'rgba(40,174,158,0.22)' },
  mapFallbackGlyph: { color: '#168C83', fontSize: 35 },
  mapEyebrow: { color: '#168C83', fontSize: 9, fontWeight: '900', letterSpacing: 1.4, marginTop: 20 },
  mapTitle: { color: '#122C34', fontSize: 22, fontWeight: '800', marginTop: 7 },
  mapBody: { color: '#53686B', fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 7 },
  mapAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 18, marginTop: 18, borderRadius: 14, backgroundColor: '#122C34' },
  mapActionText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900', letterSpacing: 0.9 },
  guidanceFallback: { position: 'absolute', zIndex: 8, left: 12, right: 12, bottom: 12, padding: 19, borderRadius: 24, backgroundColor: '#101E28', borderWidth: 1, borderColor: 'rgba(255,255,255,0.13)', elevation: 14 },
  action: { minHeight: 40, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 14, marginTop: 15, borderRadius: 12, backgroundColor: '#72E5D1' },
  actionText: { color: '#0C3032', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
});
