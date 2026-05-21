import { light, ThemeProvider } from '@amboss/design-system';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ModelSpec } from '@/lib/workflows/lib/llm';
import { modelKey, writeSpec } from './model-selection-storage';
import { ModelSelector } from './model-selector';
import { ModelSettingsPopover } from './model-settings-popover';

const slug = 'cardiology';
const stage = 'consolidate_primary';
const key = modelKey(slug, stage);

const opus: ModelSpec = {
  provider: 'anthropic',
  model: 'claude-opus-4-7',
  reasoning: 'auto',
};

function renderWithTheme(ui: ReactNode) {
  return render(<ThemeProvider theme={light}>{ui}</ThemeProvider>);
}

async function selectOption(combo: HTMLElement, optionName: RegExp | string) {
  fireEvent.click(combo);
  const option = await screen.findByRole('option', { name: optionName });
  fireEvent.mouseDown(option);
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('ModelSelector', () => {
  it('initially displays the effective default model', async () => {
    renderWithTheme(<ModelSelector specialtySlug={slug} stage={stage} />);

    expect(
      await screen.findByRole('combobox', { name: 'Gemini 3.1 Pro Preview' }),
    ).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'High reasoning' })).toBeTruthy();
  });

  it('displays a stored Opus override as selected', async () => {
    writeSpec(key, opus);

    renderWithTheme(<ModelSelector specialtySlug={slug} stage={stage} />);

    expect(await screen.findByRole('combobox', { name: 'Claude Opus 4.7' })).toBeTruthy();
    expect(
      screen.getByRole('combobox', { name: 'Auto (provider default)' }),
    ).toBeTruthy();
  });

  it('selecting Gemini writes the consolidate_primary localStorage key', async () => {
    renderWithTheme(<ModelSelector specialtySlug={slug} stage={stage} />);

    await selectOption(
      await screen.findByRole('combobox', { name: 'Gemini 3.1 Pro Preview' }),
      'Gemini 3.1 Pro Preview',
    );

    expect(JSON.parse(window.localStorage.getItem(key) ?? '{}')).toMatchObject({
      provider: 'google',
      model: 'gemini-3.1-pro-preview',
      reasoning: 'high',
    });
  });

  it('reset to default removes the stored override key', async () => {
    writeSpec(key, opus);

    renderWithTheme(<ModelSelector specialtySlug={slug} stage={stage} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Reset to default' }));

    expect(window.localStorage.getItem(key)).toBeNull();
    expect(
      await screen.findByRole('combobox', { name: 'Gemini 3.1 Pro Preview' }),
    ).toBeTruthy();
  });

  it('updates when the model storage event fires after localStorage changes', async () => {
    renderWithTheme(<ModelSelector specialtySlug={slug} stage={stage} />);

    expect(
      await screen.findByRole('combobox', { name: 'Gemini 3.1 Pro Preview' }),
    ).toBeTruthy();

    window.localStorage.setItem(key, JSON.stringify(opus));
    window.dispatchEvent(new CustomEvent('pipeline:model-storage', { detail: { key } }));

    expect(await screen.findByRole('combobox', { name: 'Claude Opus 4.7' })).toBeTruthy();
  });
});

describe('ModelSettingsPopover', () => {
  it('keeps the settings panel open while selecting model and reasoning options', async () => {
    renderWithTheme(<ModelSettingsPopover specialtySlug={slug} stage={stage} />);

    fireEvent.click(screen.getByRole('button', { name: 'Model settings' }));

    const panel = await screen.findByText('Default: Gemini 3.1 Pro Preview');
    expect(panel).toBeTruthy();

    await selectOption(
      await screen.findByRole('combobox', { name: 'Gemini 3.1 Pro Preview' }),
      'Claude Opus 4.7',
    );

    expect(screen.getByText('Default: Gemini 3.1 Pro Preview')).toBeTruthy();
    expect(await screen.findByRole('combobox', { name: 'Claude Opus 4.7' })).toBeTruthy();

    await selectOption(
      screen.getByRole('combobox', { name: 'High reasoning' }),
      'Auto (provider default)',
    );

    expect(screen.getByText('Default: Gemini 3.1 Pro Preview')).toBeTruthy();
    expect(
      await screen.findByRole('combobox', { name: 'Auto (provider default)' }),
    ).toBeTruthy();

    const popoverRoot = screen
      .getByText('Default: Gemini 3.1 Pro Preview')
      .closest('div');
    expect(
      popoverRoot
        ? within(popoverRoot).queryByRole('option', { name: 'Claude Opus 4.7' })
        : null,
    ).toBeNull();
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(key) ?? '{}')).toMatchObject({
        provider: 'anthropic',
        model: 'claude-opus-4-7',
        reasoning: 'auto',
      }),
    );
  });
});
