import { useEffect, useState } from 'react';

export interface ConnectedChannels {
  /** Inbound mailbox this workspace connected (empty when none is connected). */
  mailbox: string;
  /** WhatsApp business number this workspace connected (empty when none is connected). */
  whatsapp: string;
}

const NONE: ConnectedChannels = { mailbox: '', whatsapp: '' };

/**
 * What THIS workspace has actually connected: its own inbound mailbox and its own WhatsApp number.
 * Nothing is read from platform-wide settings, so one workspace never sees another's address or number,
 * and nothing is shown when nothing is connected.
 */
export function useConnectedChannels(tenantId?: string): ConnectedChannels {
  const [channels, setChannels] = useState<ConnectedChannels>(NONE);

  useEffect(() => {
    let cancelled = false;
    setChannels(NONE);
    if (!tenantId || tenantId === 'platform') return;

    const mailboxReq = fetch(`/api/tenants/${encodeURIComponent(tenantId)}/inbound`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => (data && data.enabled && data.status === 'connected' && data.user ? String(data.user) : ''))
      .catch(() => '');

    const whatsappReq = fetch('/api/channels/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) =>
        data?.whatsapp?.connected && data.whatsapp.connection?.displayPhoneNumber
          ? String(data.whatsapp.connection.displayPhoneNumber)
          : ''
      )
      .catch(() => '');

    Promise.all([mailboxReq, whatsappReq]).then(([mailbox, whatsapp]) => {
      if (!cancelled) setChannels({ mailbox, whatsapp });
    });

    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return channels;
}
