import type { StateId, WidgetType } from './types';

/**
 * How an element exports:
 * - 'style' — StyleBoxTexture per state, wired to `<ThemeType>/styles/<state>`
 * - 'icon'  — plain texture per state, wired to `<ThemeType>/icons/<state>`
 * - 'texture' — PNG only, nothing to wire (TextureProgressBar's node
 *   properties, freeform art)
 */
export type ElementKind = 'style' | 'icon' | 'texture';

export interface StateSpec {
  /** Godot theme item name, e.g. 'normal', 'grabber_highlight' */
  id: StateId;
  /**
   * Which state stands in for this one while it's unpainted — in the preview
   * and in the exported Theme (hover reuses normal rather than dropping back
   * to Godot's grey default). Also what the canvas onion-skins underneath.
   */
  from?: StateId;
  /** Godot draws this state *on top of* the current one instead of instead
   *  of it (focus rings), so it has no fallback and is never onion-skinned. */
  overlay?: boolean;
}

export interface ElementSpec {
  /** stable key in saved files */
  id: string;
  label: string;
  kind: ElementKind;
  defaultSize: [number, number];
  /** display order; the first is the element's base state */
  states: StateSpec[];
  /** one-line hint shown under the element tabs */
  hint?: string;
}

/**
 * Which drawing routine the preview panel uses — mirrors how the Godot
 * control lays its theme items out, so what you see is what the game draws.
 */
export type PreviewLayout =
  | 'button'
  | 'toggle'
  | 'field'
  | 'spinbox'
  | 'panel'
  | 'progress'
  | 'textureprogress'
  | 'hslider'
  | 'vslider'
  | 'hscroll'
  | 'vscroll'
  | 'tabs'
  | 'list'
  | 'window'
  | 'hseparator'
  | 'vseparator'
  | 'image';

/**
 * A Godot theme colour item the widget exposes — mostly font colours per
 * state. Exported as `<ThemeType>/colors/<id>`; only colours you actually set
 * are written, the rest stay Godot's defaults.
 */
export interface ColorSpec {
  /** Godot theme item name, e.g. 'font_hover_color' */
  id: string;
  label: string;
  /** the state this colour belongs to — highlighted while that state is on the canvas */
  state?: StateId;
  /** what the preview shows while this one is unset (Godot falls back to its own default instead) */
  from?: string;
  /** written under another theme type (Tooltips' text lives on TooltipLabel, not TooltipPanel) */
  themeType?: string;
  hint?: string;
}

export type WidgetCategory = 'Buttons' | 'Text' | 'Range' | 'Containers' | 'Lists & tabs' | 'Other';

export interface WidgetSpec {
  type: WidgetType;
  label: string;
  category: WidgetCategory;
  /** Godot theme type the styles/icons are written under; null = PNGs only */
  themeType: string | null;
  /** first element is the one a new widget opens on */
  elements: ElementSpec[];
  preview: PreviewLayout;
  /** theme colour items (font colours per state, …) */
  colors?: ColorSpec[];
  /** where a version-1 (single canvas) widget's images land when loaded */
  legacy?: { element: string; rename?: Record<string, StateId> };
}

// ---- shared state sets ------------------------------------------------------

const BUTTON_STATES: StateSpec[] = [
  { id: 'normal' },
  { id: 'hover', from: 'normal' },
  { id: 'pressed', from: 'normal' },
  { id: 'disabled', from: 'normal' },
  { id: 'focus', overlay: true },
];
const TOGGLE_BUTTON_STATES: StateSpec[] = [
  { id: 'normal' },
  { id: 'hover', from: 'normal' },
  { id: 'pressed', from: 'normal' },
  { id: 'hover_pressed', from: 'pressed' },
  { id: 'disabled', from: 'normal' },
  { id: 'focus', overlay: true },
];
const FIELD_STATES: StateSpec[] = [
  { id: 'normal' },
  { id: 'focus', overlay: true },
  { id: 'read_only', from: 'normal' },
];
const CHECK_ICONS: StateSpec[] = [
  { id: 'unchecked' },
  { id: 'checked', from: 'unchecked' },
  { id: 'unchecked_disabled', from: 'unchecked' },
  { id: 'checked_disabled', from: 'checked' },
];
const RADIO_ICONS: StateSpec[] = [
  { id: 'radio_unchecked' },
  { id: 'radio_checked', from: 'radio_unchecked' },
  { id: 'radio_unchecked_disabled', from: 'radio_unchecked' },
  { id: 'radio_checked_disabled', from: 'radio_checked' },
];
const TAB_STATES: StateSpec[] = [
  { id: 'tab_unselected' },
  { id: 'tab_selected', from: 'tab_unselected' },
  { id: 'tab_hovered', from: 'tab_unselected' },
  { id: 'tab_disabled', from: 'tab_unselected' },
  { id: 'tab_focus', overlay: true },
];
// ---- colour sets (Godot 4 default theme names) ------------------------------

const BUTTON_COLORS: ColorSpec[] = [
  { id: 'font_color', label: 'Normal', state: 'normal' },
  { id: 'font_hover_color', label: 'Hover', state: 'hover', from: 'font_color' },
  { id: 'font_pressed_color', label: 'Pressed', state: 'pressed', from: 'font_color' },
  { id: 'font_hover_pressed_color', label: 'Hover pressed', state: 'hover_pressed', from: 'font_pressed_color' },
  { id: 'font_disabled_color', label: 'Disabled', state: 'disabled', from: 'font_color' },
  { id: 'font_focus_color', label: 'Focus', state: 'focus', from: 'font_color', hint: 'Normal state while focused' },
];
const TAB_COLORS: ColorSpec[] = [
  { id: 'font_unselected_color', label: 'Unselected', state: 'tab_unselected' },
  { id: 'font_selected_color', label: 'Selected', state: 'tab_selected', from: 'font_unselected_color' },
  { id: 'font_hovered_color', label: 'Hovered', state: 'tab_hovered', from: 'font_unselected_color' },
  { id: 'font_disabled_color', label: 'Disabled', state: 'tab_disabled', from: 'font_unselected_color' },
];
const FIELD_EXTRA_COLORS: ColorSpec[] = [
  { id: 'font_placeholder_color', label: 'Placeholder', from: 'font_color' },
  { id: 'font_selected_color', label: 'Selected text', from: 'font_color' },
  { id: 'selection_color', label: 'Selection', hint: 'Background behind selected text' },
  { id: 'caret_color', label: 'Caret', from: 'font_color' },
];

const LIST_PANEL_STATES: StateSpec[] = [{ id: 'panel' }, { id: 'focus', overlay: true }];

function single(id: string, label: string, kind: ElementKind, size: [number, number], hint?: string): ElementSpec {
  return { id, label, kind, defaultSize: size, states: [{ id }], hint };
}

const PANEL = (size: [number, number]): ElementSpec => single('panel', 'Panel', 'style', size);

function sliderElements(vertical: boolean): ElementSpec[] {
  const track: [number, number] = vertical ? [6, 64] : [64, 6];
  const thickness = vertical ? 'left + right' : 'top + bottom';
  return [
    single('slider', 'Track', 'style', track, `Godot draws the track as thick as its ${thickness} content margins`),
    {
      id: 'grabber_area',
      label: 'Filled track',
      kind: 'style',
      defaultSize: track,
      states: [{ id: 'grabber_area' }, { id: 'grabber_area_highlight', from: 'grabber_area' }],
      hint: 'The part of the track up to the grabber',
    },
    {
      id: 'grabber',
      label: 'Grabber',
      kind: 'icon',
      defaultSize: vertical ? [12, 8] : [8, 12],
      states: [
        { id: 'grabber' },
        { id: 'grabber_highlight', from: 'grabber' },
        { id: 'grabber_disabled', from: 'grabber' },
      ],
      hint: 'The knob — drawn at its own size, centred on the value',
    },
    single('tick', 'Tick', 'icon', vertical ? [4, 2] : [2, 4], 'Only drawn when tick_count > 0'),
  ];
}

function scrollBarElements(vertical: boolean): ElementSpec[] {
  const icon = (id: 'increment' | 'decrement', label: string): ElementSpec => ({
    id,
    label,
    kind: 'icon',
    defaultSize: [8, 8],
    states: [
      { id },
      { id: `${id}_highlight`, from: id },
      { id: `${id}_pressed`, from: `${id}_highlight` },
    ],
    hint: 'Leave empty for a scrollbar without arrow buttons',
  });
  return [
    {
      id: 'scroll',
      label: 'Track',
      kind: 'style',
      defaultSize: vertical ? [8, 48] : [48, 8],
      states: [{ id: 'scroll' }, { id: 'scroll_focus', from: 'scroll' }],
    },
    {
      id: 'grabber',
      label: 'Grabber',
      kind: 'style',
      defaultSize: vertical ? [8, 16] : [16, 8],
      states: [
        { id: 'grabber' },
        { id: 'grabber_highlight', from: 'grabber' },
        { id: 'grabber_pressed', from: 'grabber_highlight' },
      ],
      hint: 'Stretched along the track to the visible page size',
    },
    icon('decrement', vertical ? 'Up arrow' : 'Left arrow'),
    icon('increment', vertical ? 'Down arrow' : 'Right arrow'),
  ];
}

/**
 * One entry per supported Godot control. This is what makes the "New
 * widget" type dropdown load-bearing: it decides which elements/states get
 * created, how the preview draws them, and how export wires them into a Theme.
 * Theme item names follow Godot 4's default theme.
 */
export const WIDGET_SPECS: Record<WidgetType, WidgetSpec> = {
  // ---- buttons ---------------------------------------------------------------
  button: {
    type: 'button',
    label: 'Button',
    category: 'Buttons',
    themeType: 'Button',
    colors: BUTTON_COLORS,
    elements: [{ id: 'box', label: 'Box', kind: 'style', defaultSize: [32, 16], states: TOGGLE_BUTTON_STATES }],
    preview: 'button',
    legacy: { element: 'box' },
  },
  menubutton: {
    type: 'menubutton',
    label: 'Menu Button',
    category: 'Buttons',
    themeType: 'MenuButton',
    colors: BUTTON_COLORS,
    elements: [{ id: 'box', label: 'Box', kind: 'style', defaultSize: [32, 16], states: BUTTON_STATES }],
    preview: 'button',
  },
  optionbutton: {
    type: 'optionbutton',
    label: 'Option Button',
    category: 'Buttons',
    themeType: 'OptionButton',
    colors: BUTTON_COLORS,
    elements: [
      { id: 'box', label: 'Box', kind: 'style', defaultSize: [48, 16], states: BUTTON_STATES },
      single('arrow', 'Arrow', 'icon', [8, 8], 'Drawn at the right edge, vertically centred'),
    ],
    preview: 'button',
    legacy: { element: 'box' },
  },
  checkbox: {
    type: 'checkbox',
    label: 'Check Box / Radio',
    category: 'Buttons',
    themeType: 'CheckBox',
    colors: BUTTON_COLORS,
    elements: [
      { id: 'check', label: 'Check', kind: 'icon', defaultSize: [12, 12], states: CHECK_ICONS },
      {
        id: 'radio',
        label: 'Radio',
        kind: 'icon',
        defaultSize: [12, 12],
        states: RADIO_ICONS,
        hint: 'Used instead of Check when the CheckBox has a ButtonGroup',
      },
      {
        id: 'box',
        label: 'Background',
        kind: 'style',
        defaultSize: [16, 16],
        states: TOGGLE_BUTTON_STATES,
        hint: 'Behind the whole row (icon + text) — often left empty',
      },
    ],
    preview: 'toggle',
    legacy: { element: 'box' },
  },
  checkbutton: {
    type: 'checkbutton',
    label: 'Check Button (switch)',
    category: 'Buttons',
    themeType: 'CheckButton',
    colors: BUTTON_COLORS,
    elements: [
      { id: 'switch', label: 'Switch', kind: 'icon', defaultSize: [24, 12], states: CHECK_ICONS },
      {
        id: 'box',
        label: 'Background',
        kind: 'style',
        defaultSize: [16, 16],
        states: TOGGLE_BUTTON_STATES,
        hint: 'Behind the whole row (text + switch) — often left empty',
      },
    ],
    preview: 'toggle',
  },

  // ---- text ------------------------------------------------------------------
  label: {
    type: 'label',
    label: 'Label',
    category: 'Text',
    themeType: 'Label',
    colors: [
      { id: 'font_color', label: 'Text', state: 'normal' },
      { id: 'font_shadow_color', label: 'Shadow', hint: 'Drawn 1px down-right when not transparent' },
    ],
    elements: [single('normal', 'Background', 'style', [32, 16])],
    preview: 'field',
  },
  richtextlabel: {
    type: 'richtextlabel',
    label: 'Rich Text Label',
    category: 'Text',
    themeType: 'RichTextLabel',
    colors: [
      { id: 'default_color', label: 'Text', state: 'normal' },
      { id: 'font_selected_color', label: 'Selected text', from: 'default_color' },
      { id: 'selection_color', label: 'Selection' },
    ],
    elements: [
      {
        id: 'box',
        label: 'Background',
        kind: 'style',
        defaultSize: [64, 32],
        states: [{ id: 'normal' }, { id: 'focus', overlay: true }],
      },
    ],
    preview: 'field',
  },
  lineedit: {
    type: 'lineedit',
    label: 'Line Edit',
    category: 'Text',
    themeType: 'LineEdit',
    colors: [
      { id: 'font_color', label: 'Text', state: 'normal' },
      { id: 'font_uneditable_color', label: 'Read only', state: 'read_only', from: 'font_color' },
      ...FIELD_EXTRA_COLORS,
    ],
    elements: [
      { id: 'box', label: 'Box', kind: 'style', defaultSize: [64, 16], states: FIELD_STATES },
      single('clear', 'Clear icon', 'icon', [8, 8], 'Shown at the right when clear_button_enabled'),
    ],
    preview: 'field',
    legacy: { element: 'box', rename: { disabled: 'read_only' } },
  },
  textedit: {
    type: 'textedit',
    label: 'Text Edit',
    category: 'Text',
    themeType: 'TextEdit',
    colors: [
      { id: 'font_color', label: 'Text', state: 'normal' },
      { id: 'font_readonly_color', label: 'Read only', state: 'read_only', from: 'font_color' },
      ...FIELD_EXTRA_COLORS,
    ],
    elements: [{ id: 'box', label: 'Box', kind: 'style', defaultSize: [64, 48], states: FIELD_STATES }],
    preview: 'field',
  },
  spinbox: {
    type: 'spinbox',
    label: 'Spin Box',
    category: 'Text',
    themeType: 'SpinBox',
    elements: [
      single('updown', 'Up/down arrows', 'icon', [8, 16], 'The field itself uses your LineEdit styles'),
    ],
    preview: 'spinbox',
  },

  // ---- range -----------------------------------------------------------------
  progressbar: {
    type: 'progressbar',
    label: 'Progress Bar',
    category: 'Range',
    themeType: 'ProgressBar',
    colors: [{ id: 'font_color', label: 'Percentage' }],
    elements: [
      single('background', 'Background', 'style', [64, 12]),
      single(
        'fill',
        'Fill',
        'style',
        [64, 12],
        'Stretched from the left to the value; never narrower than its left + right content margins',
      ),
    ],
    preview: 'progress',
    legacy: { element: 'background', rename: { normal: 'background' } },
  },
  textureprogressbar: {
    type: 'textureprogressbar',
    label: 'Texture Progress Bar',
    category: 'Range',
    themeType: null,
    elements: [
      single('under', 'Under', 'texture', [64, 12], 'texture_under — the empty bar'),
      single('progress', 'Progress', 'texture', [64, 12], 'texture_progress — revealed up to the value'),
      single('over', 'Over', 'texture', [64, 12], 'texture_over — frame drawn on top'),
    ],
    preview: 'textureprogress',
  },
  hslider: {
    type: 'hslider',
    label: 'H Slider',
    category: 'Range',
    themeType: 'HSlider',
    elements: sliderElements(false),
    preview: 'hslider',
  },
  vslider: {
    type: 'vslider',
    label: 'V Slider',
    category: 'Range',
    themeType: 'VSlider',
    elements: sliderElements(true),
    preview: 'vslider',
  },
  hscrollbar: {
    type: 'hscrollbar',
    label: 'H Scroll Bar',
    category: 'Range',
    themeType: 'HScrollBar',
    elements: scrollBarElements(false),
    preview: 'hscroll',
  },
  vscrollbar: {
    type: 'vscrollbar',
    label: 'V Scroll Bar',
    category: 'Range',
    themeType: 'VScrollBar',
    elements: scrollBarElements(true),
    preview: 'vscroll',
  },

  // ---- containers ------------------------------------------------------------
  panel: {
    type: 'panel',
    label: 'Panel',
    category: 'Containers',
    themeType: 'Panel',
    elements: [PANEL([48, 48])],
    preview: 'panel',
    legacy: { element: 'panel', rename: { normal: 'panel' } },
  },
  panelcontainer: {
    type: 'panelcontainer',
    label: 'Panel Container',
    category: 'Containers',
    themeType: 'PanelContainer',
    elements: [PANEL([48, 48])],
    preview: 'panel',
  },
  scrollcontainer: {
    type: 'scrollcontainer',
    label: 'Scroll Container',
    category: 'Containers',
    themeType: 'ScrollContainer',
    elements: [PANEL([48, 48])],
    preview: 'panel',
  },
  popuppanel: {
    type: 'popuppanel',
    label: 'Popup Panel',
    category: 'Containers',
    themeType: 'PopupPanel',
    elements: [PANEL([48, 32])],
    preview: 'panel',
  },
  tooltip: {
    type: 'tooltip',
    label: 'Tooltip',
    category: 'Containers',
    themeType: 'TooltipPanel',
    colors: [{ id: 'font_color', label: 'Text', themeType: 'TooltipLabel' }],
    elements: [PANEL([48, 16])],
    preview: 'panel',
  },
  window: {
    type: 'window',
    label: 'Window',
    category: 'Containers',
    themeType: 'Window',
    colors: [{ id: 'title_color', label: 'Title' }],
    elements: [
      {
        id: 'border',
        label: 'Frame',
        kind: 'style',
        defaultSize: [64, 48],
        states: [{ id: 'embedded_border' }, { id: 'embedded_unfocused_border', from: 'embedded_border' }],
        hint: 'Embedded-window frame incl. title bar (use expand margins in Godot for the title height)',
      },
      {
        id: 'close',
        label: 'Close',
        kind: 'icon',
        defaultSize: [8, 8],
        states: [{ id: 'close' }, { id: 'close_pressed', from: 'close' }],
      },
    ],
    preview: 'window',
  },

  // ---- lists & tabs ----------------------------------------------------------
  tabcontainer: {
    type: 'tabcontainer',
    label: 'Tab Container',
    category: 'Lists & tabs',
    themeType: 'TabContainer',
    colors: TAB_COLORS,
    elements: [
      { id: 'tab', label: 'Tab', kind: 'style', defaultSize: [32, 14], states: TAB_STATES },
      PANEL([64, 48]),
      single('tabbar_background', 'Tab bar background', 'style', [64, 14], 'Behind the whole row of tabs'),
    ],
    preview: 'tabs',
  },
  tabbar: {
    type: 'tabbar',
    label: 'Tab Bar',
    category: 'Lists & tabs',
    themeType: 'TabBar',
    colors: TAB_COLORS,
    elements: [
      { id: 'tab', label: 'Tab', kind: 'style', defaultSize: [32, 14], states: TAB_STATES },
      single('close', 'Close icon', 'icon', [8, 8], 'Shown on tabs when tab_close_display_policy allows it'),
    ],
    preview: 'tabs',
  },
  itemlist: {
    type: 'itemlist',
    label: 'Item List',
    category: 'Lists & tabs',
    themeType: 'ItemList',
    colors: [
      { id: 'font_color', label: 'Text' },
      { id: 'font_hovered_color', label: 'Hovered', state: 'hovered', from: 'font_color' },
      { id: 'font_selected_color', label: 'Selected', state: 'selected', from: 'font_color' },
    ],
    elements: [
      { id: 'panel', label: 'Panel', kind: 'style', defaultSize: [64, 48], states: LIST_PANEL_STATES },
      {
        id: 'item',
        label: 'Item',
        kind: 'style',
        defaultSize: [32, 12],
        states: [
          { id: 'hovered' },
          { id: 'selected', from: 'hovered' },
          { id: 'selected_focus', from: 'selected' },
          { id: 'cursor', overlay: true },
          { id: 'cursor_unfocused', overlay: true },
        ],
      },
    ],
    preview: 'list',
  },
  tree: {
    type: 'tree',
    label: 'Tree',
    category: 'Lists & tabs',
    themeType: 'Tree',
    colors: [
      { id: 'font_color', label: 'Text' },
      { id: 'font_selected_color', label: 'Selected', state: 'selected', from: 'font_color' },
    ],
    elements: [
      { id: 'panel', label: 'Panel', kind: 'style', defaultSize: [64, 48], states: LIST_PANEL_STATES },
      {
        id: 'item',
        label: 'Item',
        kind: 'style',
        defaultSize: [32, 12],
        states: [
          { id: 'selected' },
          { id: 'selected_focus', from: 'selected' },
          { id: 'cursor', overlay: true },
          { id: 'cursor_unfocused', overlay: true },
        ],
      },
      {
        id: 'arrow',
        label: 'Fold arrow',
        kind: 'icon',
        defaultSize: [8, 8],
        states: [{ id: 'arrow' }, { id: 'arrow_collapsed', from: 'arrow' }],
      },
      {
        id: 'check',
        label: 'Check',
        kind: 'icon',
        defaultSize: [8, 8],
        states: [{ id: 'unchecked' }, { id: 'checked', from: 'unchecked' }],
      },
    ],
    preview: 'list',
  },
  popupmenu: {
    type: 'popupmenu',
    label: 'Popup Menu',
    category: 'Lists & tabs',
    themeType: 'PopupMenu',
    colors: [
      { id: 'font_color', label: 'Text' },
      { id: 'font_hover_color', label: 'Hover', state: 'hover', from: 'font_color' },
      { id: 'font_disabled_color', label: 'Disabled', from: 'font_color' },
      { id: 'font_accelerator_color', label: 'Shortcut', from: 'font_color' },
      { id: 'font_separator_color', label: 'Separator label', from: 'font_color' },
    ],
    elements: [
      PANEL([48, 48]),
      single('hover', 'Hovered item', 'style', [32, 12]),
      single('separator', 'Separator', 'style', [32, 4], 'Drawn as thick as its top + bottom content margins'),
      {
        id: 'check',
        label: 'Check',
        kind: 'icon',
        defaultSize: [8, 8],
        states: [{ id: 'unchecked' }, { id: 'checked', from: 'unchecked' }],
      },
      {
        id: 'radio',
        label: 'Radio',
        kind: 'icon',
        defaultSize: [8, 8],
        states: [{ id: 'radio_unchecked' }, { id: 'radio_checked', from: 'radio_unchecked' }],
      },
      single('submenu', 'Submenu arrow', 'icon', [8, 8]),
    ],
    preview: 'list',
  },

  // ---- other -----------------------------------------------------------------
  hseparator: {
    type: 'hseparator',
    label: 'H Separator',
    category: 'Other',
    themeType: 'HSeparator',
    elements: [single('separator', 'Line', 'style', [32, 4], 'Drawn as thick as its top + bottom content margins')],
    preview: 'hseparator',
  },
  vseparator: {
    type: 'vseparator',
    label: 'V Separator',
    category: 'Other',
    themeType: 'VSeparator',
    elements: [single('separator', 'Line', 'style', [4, 32], 'Drawn as thick as its left + right content margins')],
    preview: 'vseparator',
  },
  freeform: {
    type: 'freeform',
    label: 'Freeform',
    category: 'Other',
    themeType: null,
    elements: [{ id: 'image', label: 'Image', kind: 'texture', defaultSize: [32, 32], states: [{ id: 'normal' }] }],
    preview: 'image',
    legacy: { element: 'image' },
  },
};

export const WIDGET_TYPES: WidgetType[] = Object.keys(WIDGET_SPECS) as WidgetType[];

export const WIDGET_CATEGORIES: WidgetCategory[] = ['Buttons', 'Text', 'Range', 'Containers', 'Lists & tabs', 'Other'];

/** Widget types grouped for an <optgroup>-style picker. */
export function widgetTypesByCategory(): Array<{ category: WidgetCategory; types: WidgetType[] }> {
  return WIDGET_CATEGORIES.map((category) => ({
    category,
    types: WIDGET_TYPES.filter((t) => WIDGET_SPECS[t].category === category),
  }));
}

export function specFor(type: WidgetType): WidgetSpec {
  return WIDGET_SPECS[type] ?? WIDGET_SPECS.freeform;
}

export function elementSpec(type: WidgetType, elementId: string): ElementSpec | null {
  return specFor(type).elements.find((e) => e.id === elementId) ?? null;
}

export function stateSpec(type: WidgetType, elementId: string, stateId: StateId): StateSpec | null {
  return elementSpec(type, elementId)?.states.find((s) => s.id === stateId) ?? null;
}

/** 'grabber_area_highlight' → 'grabber area highlight' */
export function stateLabel(id: StateId): string {
  return id.replace(/_/g, ' ');
}
