import NavigationHomeScreen from './src/features/navigation/NavigationHomeScreen';
import { RecoveryBoundary } from './src/components/RecoveryBoundary';

export default function App() {
  return <RecoveryBoundary scope="app"><NavigationHomeScreen /></RecoveryBoundary>;
}
