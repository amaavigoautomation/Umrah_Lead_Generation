#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import puppeteer from 'puppeteer-core';

const rl = readline.createInterface({ input, output });

function chromeCandidates() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return [
      process.env.CHROME_PATH,
      process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe') : '',
      process.env['PROGRAMFILES(X86)'] ? path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe') : '',
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe') : '',
    ].filter(Boolean);
  }
  if (process.platform === 'darwin') {
    return [
      process.env.CHROME_PATH,
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    ].filter(Boolean);
  }
  return [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
}

async function findChrome() {
  for (const candidate of chromeCandidates()) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error('Google Chrome was not found. Install Chrome or set CHROME_PATH to the Chrome executable.');
}

async function readOriginStorage(page, origin) {
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  return page.evaluate(() => {
    const localStorageItems = [];
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const name = localStorage.key(index);
        if (name) localStorageItems.push({ name, value: localStorage.getItem(name) || '' });
      }
    } catch {}
    return localStorageItems;
  });
}

async function main() {
  const profileDir = path.join(process.cwd(), '.meeting-bot-google-profile');
  const outputPath = path.resolve(process.cwd(), process.env.MEETING_BOT_SESSION_OUT || 'meeting-bot-google-session.json');

  console.log('\nAmaavigo Meeting Intelligence — Google account session setup');
  console.log("Chrome: existing manually authenticated Chrome via CDP");
  console.log('Dedicated profile:', profileDir);
  console.log('\nUse a dedicated Google Workspace account for the meeting bot.');
  console.log('Do not use your personal Google account. Do not share this browser profile or exported file.');
  console.log('This helper does not ask for, read, or store your Google password or 2-step verification code.\n');

  const accountEmail = (await rl.question('Dedicated bot Google account email: ')).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail)) {
    throw new Error('Enter a valid Google account email address.');
  }

  const cdpUrl = process.env.MEETING_BOT_CDP_URL || "http://127.0.0.1:9222";
  const browser = await puppeteer.connect({ browserURL: cdpUrl, defaultViewport: null });
  console.log("Connected to existing Chrome:", cdpUrl);

  try {
    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    await page.goto('https://accounts.google.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });

    console.log('\nConnected to your existing Chrome session.');
    console.log('Sign in manually to the dedicated bot account, complete any Google security checks,');
    console.log('and confirm that the account avatar/profile is visible. Do not automate or bypass security checks.');
    await rl.question('\nWhen the dedicated account is signed in, return here and press Enter: ');

    const origins = [];
    for (const origin of ['https://accounts.google.com', 'https://meet.google.com', 'https://www.google.com']) {
      const localStorage = await readOriginStorage(page, origin);
      origins.push({ origin, localStorage });
    }

    const client = await page.createCDPSession();
    const { cookies: allCookies = [] } = await client.send('Network.getAllCookies');
    const cookies = allCookies
      .filter((cookie) => {
        const domain = String(cookie.domain || '').toLowerCase().replace(/^\./, '');
        return domain === 'google.com' || domain.endsWith('.google.com');
      })
      .map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
      }));

    const authCookieNames = new Set(cookies.map((cookie) => cookie.name));
    const hasGoogleSessionCookie = ['SID', '__Secure-1PSID', '__Secure-3PSID', 'OSID', '__Secure-OSID']
      .some((name) => authCookieNames.has(name));
    if (cookies.length < 4 || !hasGoogleSessionCookie) {
      throw new Error(
        'A signed-in Google session could not be confirmed from Chrome cookies. Check the account is signed in, then run this helper again.'
      );
    }

    const payload = {
      version: 1,
      provider: 'google',
      accountEmail,
      exportedAt: new Date().toISOString(),
      cookies,
      origins,
    };

    await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { await fs.chmod(outputPath, 0o600); } catch {}

    console.log('\nSession export created:', outputPath);
    console.log('Google cookies exported:', cookies.length);
    console.log('\nNext steps:');
    console.log('1. Upload this JSON in Demo Scheduling → Meeting Intelligence → Google bot account.');
    console.log('2. Invite ' + accountEmail + ' to the Google Calendar event that owns each test Meet link.');
    console.log('3. After the upload succeeds, securely delete the exported JSON file.');
    console.log('4. Keep the local Chrome profile private; it contains the signed-in account session.');
  } finally {
    browser.disconnect();
    rl.close();
  }
}

main().catch((error) => {
  console.error('\nGoogle session export failed:', error?.message || error);
  rl.close();
  process.exitCode = 1;
});
