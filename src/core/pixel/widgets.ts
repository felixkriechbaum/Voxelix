import type { StateId, WidgetType } from './types';

export interface WidgetIconSpec {
  id: string;
  label: string;
  size: [number, number];
  /** Godot theme lookup key this icon fills, e.g. 'OptionButton/icons/arrow' */
  themeKey: string;
}

export interface WidgetSpec {
  type: WidgetType;
  label: string;
  defaultSize: [number, number];
  /** display order; [] = a single image, no per-state variants */
  states: StateId[];
  /** Godot theme type this widget's styleboxes target, e.g. 'Button' */
  themeType: string | null;
  icons?: WidgetIconSpec[];
}

const BUTTON_STATES: StateId[] = ['normal', 'hover', 'pressed', 'disabled', 'focus'];

/**
 * One entry per supported widget type. This is what makes the "New widget"
 * type dropdown load-bearing rather than cosmetic: it decides which states
 * get created and how export maps images onto a Godot Theme.
 */
export const WIDGET_SPECS: Record<WidgetType, WidgetSpec> = {
  button: {
    type: 'button',
    label: 'Button',
    defaultSize: [32, 16],
    states: BUTTON_STATES,
    themeType: 'Button',
  },
  optionbutton: {
    type: 'optionbutton',
    label: 'Option Button',
    defaultSize: [48, 16],
    states: BUTTON_STATES,
    themeType: 'OptionButton',
    icons: [{ id: 'arrow', label: 'Arrow', size: [8, 8], themeKey: 'OptionButton/icons/arrow' }],
  },
  checkbox: {
    type: 'checkbox',
    label: 'Checkbox',
    defaultSize: [16, 16],
    states: ['normal', 'hover', 'pressed', 'disabled'],
    themeType: 'CheckBox',
  },
  panel: {
    type: 'panel',
    label: 'Panel',
    defaultSize: [64, 64],
    states: ['normal'],
    themeType: 'Panel',
  },
  lineedit: {
    type: 'lineedit',
    label: 'Line Edit',
    defaultSize: [64, 16],
    states: ['normal', 'focus', 'disabled'],
    themeType: 'LineEdit',
  },
  progressbar: {
    type: 'progressbar',
    label: 'Progress Bar',
    defaultSize: [64, 12],
    states: ['normal'],
    themeType: 'ProgressBar',
  },
  freeform: {
    type: 'freeform',
    label: 'Freeform',
    defaultSize: [32, 32],
    states: [],
    themeType: null,
  },
};

export const WIDGET_TYPES: WidgetType[] = Object.keys(WIDGET_SPECS) as WidgetType[];

export function specFor(type: WidgetType): WidgetSpec {
  return WIDGET_SPECS[type];
}
