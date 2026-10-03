import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase/config.js';
import { sanitizeForFirestore } from './firestoreUtils.js';
import { PLATFORM_CLIENT_ID } from './sendingIdentities.js';
import type { Client } from '../types/index.js';

/**
 * Clients (tenants). Each client logs in with its own users and sends through its own sending identities.
 * Platform staff are users without a clientId.
 */

const clients = new Map<string, Client>();

async function loadClients(): Promise<void> {
  if (!isFirebaseConfigured || !db) return;
  try {
    const snap = await getDocs(collection(db, 'clients'));
    clients.clear();
    snap.forEach((d) => {
      const c = d.data() as Client;
      if (c && c.clientId) clients.set(c.clientId, c);
    });
  } catch (e) {
    console.warn('[Clients] Could not load clients from Firestore, using cache:', e);
  }
}

export async function listClients(): Promise<Client[]> {
  await loadClients();
  return Array.from(clients.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getClient(clientId: string): Promise<Client | null> {
  await loadClients();
  return clients.get(clientId) || null;
}

export async function saveClient(input: { clientId?: string; name: string; isActive?: boolean }): Promise<Client> {
  await loadClients();
  const name = (input.name || '').trim();
  if (!name) throw new Error('Client name is required.');

  const existing = input.clientId ? clients.get(input.clientId) : undefined;
  if (input.clientId && !existing) throw new Error('Client not found.');

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'client';
  const clientId = existing?.clientId || `cli-${slug}-${Math.random().toString(36).slice(2, 6)}`;
  if (clientId === PLATFORM_CLIENT_ID) throw new Error('Reserved client id.');

  const now = new Date().toISOString();
  const client: Client = {
    clientId,
    name,
    isActive: input.isActive !== false,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  clients.set(clientId, client);
  if (isFirebaseConfigured && db) {
    await setDoc(doc(db, 'clients', clientId), sanitizeForFirestore(client));
  }
  return client;
}
