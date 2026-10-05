/**
 * Signup flow — verifies the email/password registration path renders, the
 * client-side password validation kicks in, normal signup continues to email
 * verification, and a valid project invitation opens the signed-in project.
 *
 * Runs without storage state (project: chromium-public).
 */
import { test, expect } from '@playwright/test';
import { E2E_PROJECT_INVITE_TOKEN } from './fixtures/seed';

test.describe('signup', () => {
  test('rejects passwords shorter than 8 characters', async ({ page }) => {
    await page.goto('/auth/signup');

    // Wait for the form (it briefly waits on /api/setup).
    await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible();

    await page.getByLabel(/full name/i).fill('Too Short');
    await page.getByLabel(/email address/i).fill(`shortpw+${Date.now()}@validteam.test`);
    await page.getByLabel(/^password$/i).fill('short');
    await page.getByRole('button', { name: /create account/i }).click();

    await expect(page.getByText(/password must be at least 8 characters/i)).toBeVisible();
  });

  test('creates a new account and continues to email verification', async ({ page }) => {
    const email = `e2e-signup+${Date.now()}@validteam.test`;

    await page.goto('/auth/signup');
    await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible();

    await page.getByLabel(/full name/i).fill('E2E Signup');
    await page.getByLabel(/email address/i).fill(email);
    await page.getByLabel(/^password$/i).fill('Pa55word!2026');

    await page.getByRole('button', { name: /create account/i }).click();

    await page.waitForURL(/\/auth\/verify-request\?email=/, { timeout: 30_000 });
    await expect(page).toHaveURL(/\/auth\/verify-request\?email=e2e-signup%2B/);
  });

  test('accepts a project invite during signup and opens the project', async ({ page }) => {
    const email = `e2e-project-invite+${Date.now()}@validteam.test`;

    await page.goto(`/join/project/${E2E_PROJECT_INVITE_TOKEN}`);
    await expect(page).toHaveURL(
      new RegExp(`/auth/signup\\?projectInviteToken=${E2E_PROJECT_INVITE_TOKEN}$`)
    );
    await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible();

    await page.getByLabel(/full name/i).fill('E2E Project Invite');
    await page.getByLabel(/email address/i).fill(email);
    await page.getByLabel(/^password$/i).fill('Pa55word!2026');
    await page.getByRole('button', { name: /create account/i }).click();

    await page.waitForURL(/\/projects\/E2E(?:[/?#]|$)/, { timeout: 30_000 });
    await expect(page).toHaveURL(/\/projects\/E2E(?:[/?#]|$)/);
  });
});
