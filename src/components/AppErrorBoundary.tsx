import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';

interface AppErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep silent in UI; log for developer diagnostics only
    console.error('[EduRun ErrorBoundary]', error, info.componentStack);
  }

  handleRecover = () => {
    this.setState({ hasError: false });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen w-full bg-[#081226] text-white flex items-center justify-center p-6">
        <div className="max-w-md w-full p-6 rounded-2xl bg-[#0F2957] border border-blue-400/30 shadow-2xl text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-[#FACC15]/50 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6 text-[#FACC15]" />
          </div>
          <h2 className="font-display font-bold text-xl">
            {this.props.fallbackTitle || 'Tampilan Sedang Dipulihkan'}
          </h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            Terjadi gangguan sementara saat berpindah halaman. Klik tombol di bawah untuk kembali menampilkan dashboard secara normal.
          </p>
          <div className="flex items-center justify-center gap-3 pt-1">
            <button
              type="button"
              onClick={this.handleRecover}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#FF6B1A] hover:bg-[#e85d10] font-semibold text-sm text-white cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Pulihkan Tampilan</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
