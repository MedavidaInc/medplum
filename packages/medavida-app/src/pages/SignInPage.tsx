import { SignInForm, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useNavigate } from 'react-router';

export function SignInPage(): JSX.Element {
  const medplum = useMedplum();
  const navigate = useNavigate();

  return (
    <SignInForm
      onSuccess={async () => {
        await medplum.getProfile();
        navigate('/');
      }}
    />
  );
}
