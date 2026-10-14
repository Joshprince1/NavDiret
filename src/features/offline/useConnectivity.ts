import * as Network from 'expo-network';
import { useCallback, useEffect, useState } from 'react';

export function useConnectivity() {
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const updateNetwork = useCallback((state: Network.NetworkState) => {
    setIsOnline(state.isInternetReachable ?? state.isConnected ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Network.getNetworkStateAsync().then((state) => { if (!cancelled) updateNetwork(state); }).catch(() => undefined);
    const subscription = Network.addNetworkStateListener(updateNetwork);
    return () => { cancelled = true; subscription.remove(); };
  }, [updateNetwork]);

  return { isOnline };
}
