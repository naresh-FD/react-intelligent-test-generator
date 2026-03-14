import { useEffect, useState } from 'react';

export function DelayedMessage() {
  const [message, setMessage] = useState('Loading');

  useEffect(() => {
    const timeout = setTimeout(() => {
      setMessage('Saved');
    }, 10);

    return () => clearTimeout(timeout);
  }, []);

  return <div>{message}</div>;
}

export default DelayedMessage;
