import type { IncomingMessage, ServerResponse } from 'http';
import chromium from '@sparticuz/chromium';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { authenticateRequest } from '../../src/server/authMiddleware.js';

type ApiRequest = IncomingMessage & { body?: any };
type AudioCaptureResult = {
  base64: string;
  mimeType: string;
  byteLength: number;
  recordingMs: number;
  audioTrackCount: number;
};

const BOT_DISPLAY_NAME = 'Amaavigo Meeting Intelligence Trial Bot';
const MAX_JOIN_WAIT_MS = 90_000;
const MAX_TRACK_WAIT_MS = 20_000;

function sendJson(res: ServerResponse, status: number, payload: Record<string, any>) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.end(JSON.stringify(payload));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs before Meet's application scripts. It observes incoming WebRTC audio
 * tracks, mixes them through Web Audio, and records the mixed stream in-page.
 * No OS audio device, PulseAudio, microphone, or speaker loopback is required.
 */
function installRemoteAudioCapture() {
  const w: any = window;
  if (w.__remoteAudioCaptureInstalled) return;
  w.__remoteAudioCaptureInstalled = true;

  const NativePeerConnection = w.RTCPeerConnection || w.webkitRTCPeerConnection;
  if (!NativePeerConnection) return;

  const remoteTracks = new Map<string, MediaStreamTrack>();
  const connectedTrackIds = new Set<string>();
  let audioContext: AudioContext | null = null;
  let destination: MediaStreamAudioDestinationNode | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let recordingStartedAt = 0;
  let activeMimeType = 'audio/webm';

  const connectTrack = (track: MediaStreamTrack) => {
    if (!track || track.kind !== 'audio') return;
    remoteTracks.set(track.id, track);
    if (!audioContext || !destination || connectedTrackIds.has(track.id) || track.readyState === 'ended') return;
    try {
      const source = audioContext.createMediaStreamSource(new MediaStream([track]));
      source.connect(destination);
      connectedTrackIds.add(track.id);
    } catch {
      // A track may end while the page is reconnecting. A later track event will be observed.
    }
  };

  const WrappedPeerConnection = new Proxy(NativePeerConnection, {
    construct(target, args, newTarget) {
      const peerConnection = Reflect.construct(target, args, newTarget);
      peerConnection.addEventListener('track', (event: RTCTrackEvent) => {
        if (event.track?.kind === 'audio') connectTrack(event.track);
        for (const stream of event.streams || []) {
          for (const track of stream.getAudioTracks()) connectTrack(track);
        }
      });
      return peerConnection;
    },
  });

  try {
    w.RTCPeerConnection = WrappedPeerConnection;
    if (w.webkitRTCPeerConnection) w.webkitRTCPeerConnection = WrappedPeerConnection;
  } catch {}

  w.__remoteAudioCapture = {
    installed: true,
    status: () => ({
      audioTrackCount: remoteTracks.size,
      connectedTrackCount: connectedTrackIds.size,
      recorderState: recorder?.state || 'not-started',
    }),
    start: async () => {
      if (recorder && recorder.state !== 'inactive') {
        throw new Error('Audio recording is already running.');
      }
      const AudioContextConstructor = w.AudioContext || w.webkitAudioContext;
      if (!AudioContextConstructor || !w.MediaRecorder) {
        throw new Error('This Chromium build does not support Web Audio recording APIs.');
      }
      audioContext = new AudioContextConstructor();
      destination = audioContext.createMediaStreamDestination();
      await audioContext.resume();

      for (const track of remoteTracks.values()) connectTrack(track);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      activeMimeType = mimeType || 'audio/webm';
      recorder = mimeType
        ? new MediaRecorder(destination.stream, { mimeType })
        : new MediaRecorder(destination.stream);
      chunks = [];
      recorder.addEventListener('dataavailable', (event: BlobEvent) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      });
      recordingStartedAt = performance.now();
      recorder.start(1000);
      return {
        audioTrackCount: remoteTracks.size,
        connectedTrackCount: connectedTrackIds.size,
        mimeType: recorder.mimeType || activeMimeType,
      };
    },
    stop: async (): Promise<AudioCaptureResult> => {
      if (!recorder) throw new Error('Audio recording was not started.');
      if (recorder.state !== 'inactive') {
        await new Promise<void>((resolve) => {
          recorder!.addEventListener('stop', () => resolve(), { once: true });
          recorder!.stop();
        });
      }
      const mimeType = recorder.mimeType || activeMimeType;
      const blob = new Blob(chunks, { type: mimeType });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      const base64 = w.btoa(binary);
      const result = {
        base64,
        mimeType,
        byteLength: bytes.byteLength,
        recordingMs: Math.max(0, Math.round(performance.now() - recordingStartedAt)),
        audioTrackCount: remoteTracks.size,
      };
      try { await audioContext?.close(); } catch {}
      return result;
    },
  };
}

async function getMeetState(page: Page) {
  return page.evaluate(() => {
    const bodyText = (document.body?.innerText || '').toLowerCase();
    const labels = Array.from(document.querySelectorAll('button,[role="button"]'))
      .map((element) => [
        element.getAttribute('aria-label') || '',
        element.getAttribute('data-tooltip') || '',
        element.textContent || '',
      ].join(' ').replace(/\s+/g, ' ').trim().toLowerCase());

    const joined = labels.some((label) => /leave call|hang up|end call/.test(label)) ||
      bodyText.includes("you're in the meeting") ||
      bodyText.includes('you are in the meeting');
    const waiting = bodyText.includes('asking to be let in') ||
      bodyText.includes("you'll join the call when someone lets you in") ||
      bodyText.includes('waiting for the host') ||
      bodyText.includes('waiting for someone to let you in');
    const signInRequired = location.hostname === 'accounts.google.com' ||
      bodyText.includes('sign in to continue') ||
      bodyText.includes('you need to sign in');
    const blocked = bodyText.includes("you can't join this video call") ||
      bodyText.includes('the meeting code you entered is invalid') ||
      bodyText.includes('this meeting has ended');

    return {
      joined,
      waiting,
      signInRequired,
      blocked,
      hasJoinButton: labels.some((label) => /ask to join|join now/.test(label)),
      pageTitle: document.title || '',
    };
  });
}

async function clickMeetJoinButton(page: Page) {
  return page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('button,[role="button"]'));
    const button = candidates.find((element) => {
      const label = [
        element.getAttribute('aria-label') || '',
        element.getAttribute('data-tooltip') || '',
        element.textContent || '',
      ].join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
      const visible = Boolean((element as HTMLElement).offsetWidth || (element as HTMLElement).offsetHeight);
      return visible && /ask to join|join now/.test(label);
    }) as HTMLElement | undefined;
    if (!button) return false;
    button.click();
    return true;
  });
}

async function muteLocalMedia(page: Page) {
  return page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('button,[role="button"]'));
    const getLabel = (element: Element) => [
      element.getAttribute('aria-label') || '',
      element.getAttribute('data-tooltip') || '',
      element.textContent || '',
    ].join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const isVisible = (element: Element) => Boolean(
      (element as HTMLElement).offsetWidth || (element as HTMLElement).offsetHeight
    );

    const microphoneButton = candidates.find((element) =>
      isVisible(element) && /turn off microphone|mute microphone/.test(getLabel(element))
    ) as HTMLElement | undefined;
    if (microphoneButton) microphoneButton.click();

    const cameraButton = Array.from(document.querySelectorAll('button,[role="button"]')).find((element) =>
      isVisible(element) && /turn off camera/.test(getLabel(element))
    ) as HTMLElement | undefined;
    if (cameraButton) cameraButton.click();

    return {
      microphoneWasTurnedOff: Boolean(microphoneButton),
      cameraWasTurnedOff: Boolean(cameraButton),
    };
  });
}

export async function handleMeetingIntelligenceTrial(req: ApiRequest, res: ServerResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    return sendJson(res, 405, { success: false, error: 'POST only.' });
  }

  try {
    const auth = await authenticateRequest(req as any);
    if (!auth.ok || !auth.ctx) {
      return sendJson(res, auth.status || 401, {
        success: false,
        error: auth.error || 'Authentication required.',
        code: auth.code || 'AUTH_REQUIRED',
      });
    }
    if (!auth.ctx.isPlatformAdmin && auth.ctx.role !== 'admin') {
      return sendJson(res, 403, { success: false, error: 'Workspace administrator access is required for this trial.' });
    }

    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const meetingUrlText = String(body?.meetingUrl || '').trim();
    const consentConfirmed = body?.consentConfirmed === true;
    const recordingSeconds = Number(body?.recordingSeconds ?? 15);

    if (!consentConfirmed) {
      return sendJson(res, 400, { success: false, error: 'Confirm that all meeting participants have been informed and have consented.' });
    }
    if (!Number.isInteger(recordingSeconds) || recordingSeconds < 10 || recordingSeconds > 20) {
      return sendJson(res, 400, { success: false, error: 'Audio sample length must be between 10 and 20 seconds.' });
    }

    let meetingUrl: URL;
    try { meetingUrl = new URL(meetingUrlText); } catch {
      return sendJson(res, 400, { success: false, error: 'Enter a valid Google Meet URL.' });
    }
    if (
      meetingUrl.protocol !== 'https:' ||
      meetingUrl.hostname !== 'meet.google.com' ||
      !/^\/[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}\/?$/i.test(meetingUrl.pathname)
    ) {
      return sendJson(res, 400, { success: false, error: 'Only standard https://meet.google.com/xxx-xxxx-xxx meeting links are supported.' });
    }

    const diagnostics: string[] = [
      'Vercel serverless Chromium requested.',
      'Incoming WebRTC audio tracks will be mixed and recorded in the browser.',
    ];
    let browser: Browser | null = null;

    try {
      chromium.setGraphicsMode = false;
      browser = await puppeteer.launch({
        args: [
          ...chromium.args,
          '--autoplay-policy=no-user-gesture-required',
          '--use-fake-ui-for-media-stream',
          '--use-fake-device-for-media-stream',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
        ],
        defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
        timeout: 45_000,
      });
      diagnostics.push('Chromium launched successfully.');

      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(45_000);
      page.setDefaultTimeout(12_000);
      await page.evaluateOnNewDocument(installRemoteAudioCapture);
      await page.goto(meetingUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await sleep(4_000);

      const initialState = await getMeetState(page);
      if (initialState.signInRequired) {
        return sendJson(res, 422, {
          success: false,
          code: 'MEET_REQUIRES_GOOGLE_SIGN_IN',
          error: 'This meeting requires a signed-in Google account. The Vercel trial bot currently joins as a guest only.',
          diagnostics: [...diagnostics, 'Google sign-in was required; no credentials were entered.'],
        });
      }
      if (initialState.blocked) {
        return sendJson(res, 422, {
          success: false,
          code: 'MEET_LINK_NOT_JOINABLE',
          error: 'Google Meet did not allow this bot to join. Check the meeting link and guest-access settings.',
          diagnostics,
        });
      }

      const nameInput = await page.$('input[aria-label*="name" i], input[placeholder*="name" i]');
      if (nameInput) {
        await nameInput.click().catch(() => {});
        await nameInput.type(BOT_DISPLAY_NAME, { delay: 12 }).catch(() => {});
      }

      const mediaState = await muteLocalMedia(page);
      diagnostics.push('Local microphone off: ' + String(mediaState.microphoneWasTurnedOff) + '; camera off: ' + String(mediaState.cameraWasTurnedOff) + '.');
      diagnostics.push('Guest display name set to: ' + BOT_DISPLAY_NAME + '.');

      const clickedJoin = await clickMeetJoinButton(page);
      if (!clickedJoin) {
        return sendJson(res, 422, {
          success: false,
          code: 'MEET_JOIN_CONTROL_NOT_FOUND',
          error: 'Could not find the Google Meet Join now / Ask to join control. The page may require sign-in or a different access flow.',
          diagnostics: [...diagnostics, 'No supported join button was found.'],
        });
      }
      diagnostics.push('Join request submitted. Waiting for admission into the meeting.');

      const joinDeadline = Date.now() + MAX_JOIN_WAIT_MS;
      let joined = false;
      let waitingRoomObserved = false;
      while (Date.now() < joinDeadline) {
        const state = await getMeetState(page);
        if (state.signInRequired) {
          return sendJson(res, 422, {
            success: false,
            code: 'MEET_REQUIRES_GOOGLE_SIGN_IN',
            error: 'Google Meet redirected the bot to sign-in. Guest access is not enabled for this meeting.',
            diagnostics,
          });
        }
        if (state.blocked) {
          return sendJson(res, 422, {
            success: false,
            code: 'MEET_JOIN_BLOCKED',
            error: 'Google Meet rejected the join request.',
            diagnostics,
          });
        }
        waitingRoomObserved = waitingRoomObserved || state.waiting;
        if (state.joined) {
          joined = true;
          break;
        }
        await sleep(1_000);
      }

      if (!joined) {
        return sendJson(res, 408, {
          success: false,
          code: waitingRoomObserved ? 'MEET_HOST_ADMISSION_TIMEOUT' : 'MEET_JOIN_TIMEOUT',
          error: waitingRoomObserved
            ? 'The bot reached the waiting room, but the host did not admit it within 90 seconds.'
            : 'The bot could not confirm that it entered the meeting within 90 seconds.',
          diagnostics,
        });
      }

      diagnostics.push('Bot entered the meeting. Waiting for incoming participant audio tracks.');
      let audioTrackCount = 0;
      const trackDeadline = Date.now() + MAX_TRACK_WAIT_MS;
      while (Date.now() < trackDeadline) {
        const captureStatus = await page.evaluate(() => (window as any).__remoteAudioCapture?.status?.() || null);
        audioTrackCount = Number(captureStatus?.audioTrackCount || 0);
        if (audioTrackCount > 0) break;
        await sleep(1_000);
      }

      if (audioTrackCount < 1) {
        return sendJson(res, 422, {
          success: false,
          code: 'REMOTE_AUDIO_TRACKS_NOT_DETECTED',
          error: 'The bot joined the meeting, but Chromium did not expose any incoming audio tracks. This is the key WebRTC capture test and it did not pass.',
          diagnostics: [...diagnostics, 'No remote audio track event was observed within 20 seconds.'],
        });
      }

      const started = await page.evaluate(() => (window as any).__remoteAudioCapture.start());
      diagnostics.push('Incoming audio tracks detected: ' + Number(started?.audioTrackCount || audioTrackCount) + '.');
      diagnostics.push('Recording ' + recordingSeconds + ' seconds of remote meeting audio.');
      await sleep(recordingSeconds * 1_000);

      const capture = await page.evaluate(() => (window as any).__remoteAudioCapture.stop()) as AudioCaptureResult;
      if (!capture?.base64 || capture.byteLength < 1) {
        return sendJson(res, 422, {
          success: false,
          code: 'EMPTY_AUDIO_RECORDING',
          error: 'WebRTC tracks were detected, but the browser did not produce a playable audio recording.',
          diagnostics,
        });
      }
      if (capture.byteLength > 3_000_000) {
        return sendJson(res, 413, {
          success: false,
          code: 'AUDIO_SAMPLE_TOO_LARGE',
          error: 'The sample exceeded the safe test response size. Retry with a shorter recording.',
          diagnostics: [...diagnostics, 'Captured bytes: ' + capture.byteLength + '.'],
        });
      }

      diagnostics.push('Audio recording created successfully.');
      return sendJson(res, 200, {
        success: true,
        status: 'captured',
        botDisplayName: BOT_DISPLAY_NAME,
        audioTrackCount: capture.audioTrackCount,
        recordingMs: capture.recordingMs,
        recordingBytes: capture.byteLength,
        mimeType: capture.mimeType,
        audioDataUrl: 'data:' + capture.mimeType + ';base64,' + capture.base64,
        diagnostics,
      });
    } finally {
      if (browser) {
        try {
          await Promise.race([browser.close(), sleep(5_000)]);
        } catch {}
      }
    }
  } catch (error: any) {
    console.error('[Meeting Intelligence trial] test failed:', error?.message || error);
    return sendJson(res, 500, {
      success: false,
      code: 'MEETING_BOT_TRIAL_ERROR',
      error: error?.message || 'Could not run the meeting bot trial.',
    });
  }
}
