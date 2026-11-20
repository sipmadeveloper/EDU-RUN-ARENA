import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { formatFriendlyFirestoreError } from '../firebase';

interface FirebaseErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class FirebaseErrorBoundary extends React.Component<
  { children: React.ReactNode },
  FirebaseErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): FirebaseErrorBoundaryState {
    return {
      hasError: true,
      message: formatFriendlyFirestoreError(error),
    };
  }

  componentDidCatch(error: unknown) {
    console.error('Application ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#081226] text-white flex items-center justify-center p-6">
          <div className="max-w-md w-full p-6 rounded-2xl bg-[#0F2957] border border-rose-400/40 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-400/40 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-rose-300" />
              </div>
              <div>
                <h2 className="font-display font-bold text-lg">Terjadi Gangguan Koneksi Cloud</h2>
                <p className="text-xs text-slate-300">EDU RUN ARENA 3D</p>
              </div>
            </div>

            <p className="text-sm text-rose-100 leading-relaxed break-words">{this.state.message}</p>

            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, message: '' });
              }}
              className="w-full py-2.5 rounded-xl bg-[#FF6B1A] hover:bg-[#e85d10] font-semibold text-sm text-white inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Muat Ulang Tampilan</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
