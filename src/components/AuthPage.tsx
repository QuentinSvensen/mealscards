import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Lock, LogIn, UserPlus } from 'lucide-react';

interface AuthPageProps {
  onSignIn: (email: string, password: string) => Promise<any>;
  onSignUp: (email: string, password: string) => Promise<any>;
}

export function AuthPage({ onSignIn, onSignUp }: AuthPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    setError('');
    setMessage('');

    const err = isSignUp
      ? await onSignUp(email.trim(), password.trim())
      : await onSignIn(email.trim(), password.trim());

    if (err) {
      setError(err.message);
    } else if (isSignUp) {
      setMessage('Vérifie ton email pour confirmer ton compte.');
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-4 p-8 w-full max-w-sm">
        <Lock className="h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-bold text-foreground">
          {isSignUp ? 'Créer un compte' : 'Connexion'}
        </h2>
        <Input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          autoFocus
        />
        <Input
          type="password"
          placeholder="Mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        />
        <Button onClick={handleSubmit} disabled={loading || !email.trim() || !password.trim()} className="w-full gap-2">
          {isSignUp ? <UserPlus className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
          {isSignUp ? 'Créer le compte' : 'Se connecter'}
        </Button>
        {error && <p className="text-destructive text-sm text-center">{error}</p>}
        {message && <p className="text-green-600 text-sm text-center">{message}</p>}
        <button
          onClick={() => { setIsSignUp(!isSignUp); setError(''); setMessage(''); }}
          className="text-xs text-muted-foreground hover:underline"
        >
          {isSignUp ? 'Déjà un compte ? Se connecter' : 'Pas de compte ? Créer un compte'}
        </button>
      </div>
    </div>
  );
}
