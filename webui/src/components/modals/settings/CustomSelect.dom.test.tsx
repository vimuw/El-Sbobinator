import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CustomSelect, type CustomSelectOption } from './CustomSelect';

describe('CustomSelect', () => {
  const options: CustomSelectOption[] = [
    { value: 'm1', label: 'Model One', sublabel: 'gemini-1.5-flash' },
    { value: 'm2', label: 'Model Two', sublabel: 'gemini-1.5-pro' },
    { value: 'm3', label: 'Disabled Model', disabled: true },
  ];

  it('renders selected option and sublabel', () => {
    render(
      <CustomSelect
        value="m1"
        onChange={vi.fn()}
        options={options}
      />,
    );

    expect(screen.getAllByText('Model One').length).toBeGreaterThan(0);
    expect(screen.getByText('(gemini-1.5-flash)')).toBeTruthy();
  });

  it('opens overlay on click and selects an option', () => {
    const onChange = vi.fn();
    render(
      <CustomSelect
        value="m1"
        onChange={onChange}
        options={options}
      />,
    );

    const trigger = screen.getByRole('button', { name: /Model One/i });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    // Listbox should now be visible
    expect(screen.getByRole('listbox')).toBeTruthy();

    // Click on 'Model Two'
    const optionTwo = screen.getByRole('option', { name: /Model Two/i });
    fireEvent.click(optionTwo);

    expect(onChange).toHaveBeenCalledWith('m2');
  });

  it('closes dropdown on Escape keydown', () => {
    render(
      <CustomSelect
        value="m1"
        onChange={vi.fn()}
        options={options}
      />,
    );

    const trigger = screen.getByRole('button', { name: /Model One/i });
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('does not select disabled options', () => {
    const onChange = vi.fn();
    render(
      <CustomSelect
        value="m1"
        onChange={onChange}
        options={options}
      />,
    );

    const trigger = screen.getByRole('button', { name: /Model One/i });
    fireEvent.click(trigger);

    const disabledOpt = screen.getByRole('option', { name: /Disabled Model/i });
    fireEvent.click(disabledOpt);

    expect(onChange).not.toHaveBeenCalled();
  });
});
