// MingCute icons (core-regular for UI, core-filled for subjects and status marks).
// Each name maps to one MingCute component, imported one by one so the bundle
// only carries the icons listed here. Icons are decorative by default; pass
// `label` when an icon carries meaning alone.
import type { ComponentType } from 'react';
import type { IconProps } from '@mingcute/react';
import AddRegular from '@mingcute/react/core-regular/add';
import ArrowRightRegular from '@mingcute/react/core-regular/arrow-right';
import ArrowUpRegular from '@mingcute/react/core-regular/arrow-up';
import Book4Regular from '@mingcute/react/core-regular/book-4';
import BrainRegular from '@mingcute/react/core-regular/brain';
import BulbRegular from '@mingcute/react/core-regular/bulb';
import CalendarMonthRegular from '@mingcute/react/core-regular/calendar-month';
import CalendarRegular from '@mingcute/react/core-regular/calendar';
import ChartBarRegular from '@mingcute/react/core-regular/chart-bar';
import Chat3Regular from '@mingcute/react/core-regular/chat-3';
import CheckRegular from '@mingcute/react/core-regular/check';
import CloseRegular from '@mingcute/react/core-regular/close';
import Copy2Regular from '@mingcute/react/core-regular/copy-2';
import Delete2Regular from '@mingcute/react/core-regular/delete-2';
import Document2Regular from '@mingcute/react/core-regular/document-2';
import DownRegular from '@mingcute/react/core-regular/down';
import ExternalLinkRegular from '@mingcute/react/core-regular/external-link';
import EyeRegular from '@mingcute/react/core-regular/eye';
import EyeCloseRegular from '@mingcute/react/core-regular/eye-close';
import Flag2Regular from '@mingcute/react/core-regular/flag-2';
import GlobeRegular from '@mingcute/react/core-regular/globe';
import HistoryAnticlockwiseRegular from '@mingcute/react/core-regular/history-anticlockwise';
import Home4Regular from '@mingcute/react/core-regular/home-4';
import InboxRegular from '@mingcute/react/core-regular/inbox';
import InformationRegular from '@mingcute/react/core-regular/information';
import KeyboardRegular from '@mingcute/react/core-regular/keyboard';
import LayersRegular from '@mingcute/react/core-regular/layers';
import LeftRegular from '@mingcute/react/core-regular/left';
import LinkRegular from '@mingcute/react/core-regular/link';
import ListCheckRegular from '@mingcute/react/core-regular/list-check';
import LockRegular from '@mingcute/react/core-regular/lock';
import NotificationRegular from '@mingcute/react/core-regular/notification';
import PauseRegular from '@mingcute/react/core-regular/pause';
import PauseCircleRegular from '@mingcute/react/core-regular/pause-circle';
import PencilRegular from '@mingcute/react/core-regular/pencil';
import PencilRulerRegular from '@mingcute/react/core-regular/pencil-ruler';
import PicRegular from '@mingcute/react/core-regular/pic';
import PlayRegular from '@mingcute/react/core-regular/play';
import PowerRegular from '@mingcute/react/core-regular/power';
import QuestionRegular from '@mingcute/react/core-regular/question';
import QuillPenRegular from '@mingcute/react/core-regular/quill-pen';
import Refresh2Regular from '@mingcute/react/core-regular/refresh-2';
import RepeatRegular from '@mingcute/react/core-regular/repeat';
import RightRegular from '@mingcute/react/core-regular/right';
import SafetyCertificateRegular from '@mingcute/react/core-regular/safety-certificate';
import SandglassRegular from '@mingcute/react/core-regular/sandglass';
import ServerRegular from '@mingcute/react/core-regular/server';
import Settings3Regular from '@mingcute/react/core-regular/settings-3';
import StopCircleRegular from '@mingcute/react/core-regular/stop-circle';
import SunriseRegular from '@mingcute/react/core-regular/sunrise';
import TaskRegular from '@mingcute/react/core-regular/task';
import TargetRegular from '@mingcute/react/core-regular/target';
import TimeRegular from '@mingcute/react/core-regular/time';
import Battery1Regular from '@mingcute/react/core-regular/battery-1';
import HistoryRegular from '@mingcute/react/core-regular/history';
import Mountain2Regular from '@mingcute/react/core-regular/mountain-2';
import StopwatchRegular from '@mingcute/react/core-regular/stopwatch';
import Search2Regular from '@mingcute/react/core-regular/search-2';
import UpRegular from '@mingcute/react/core-regular/up';
import User3Regular from '@mingcute/react/core-regular/user-3';
import WarningRegular from '@mingcute/react/core-regular/warning';
import BankFilled from '@mingcute/react/core-filled/bank';
import Book2Filled from '@mingcute/react/core-filled/book-2';
import CheckCircleFilled from '@mingcute/react/core-filled/check-circle';
import CloseCircleFilled from '@mingcute/react/core-filled/close-circle';
import CodeFilled from '@mingcute/react/core-filled/code';
import Document2Filled from '@mingcute/react/core-filled/document-2';
import FlaskFilled from '@mingcute/react/core-filled/flask';
import FormulaFilled from '@mingcute/react/core-filled/formula';
import GroupFilled from '@mingcute/react/core-filled/group';
import Heartbeat2Filled from '@mingcute/react/core-filled/heartbeat-2';
import LeafFilled from '@mingcute/react/core-filled/leaf';
import MusicFilled from '@mingcute/react/core-filled/music';
import PaletteFilled from '@mingcute/react/core-filled/palette';
import ScienceFilled from '@mingcute/react/core-filled/science';
import SparklesFilled from '@mingcute/react/core-filled/sparkles';
import TranslateFilled from '@mingcute/react/core-filled/translate';
import TreeFilled from '@mingcute/react/core-filled/tree';

const icons = {
  home: Home4Regular,
  chat: Chat3Regular,
  sources: LayersRegular,
  settings: Settings3Regular,
  arrowRight: ArrowRightRegular,
  arrowUp: ArrowUpRegular,
  x: CloseRegular,
  eyeOff: EyeCloseRegular,
  clock: TimeRegular,
  plus: AddRegular,
  trash: Delete2Regular,
  play: PlayRegular,
  pause: PauseRegular,
  stop: StopCircleRegular,
  chevronLeft: LeftRegular,
  chevronRight: RightRegular,
  chevronDown: DownRegular,
  chevronUp: UpRegular,
  external: ExternalLinkRegular,
  refresh: Refresh2Regular,
  check: CheckRegular,
  checkCircle: CheckCircleFilled,
  xCircle: CloseCircleFilled,
  sparkle: SparklesFilled,
  doc: Document2Regular,
  calendar: CalendarRegular,
  calendarRange: CalendarMonthRegular,
  list: ListCheckRegular,
  listChecks: ListCheckRegular,
  user: User3Regular,
  info: InformationRegular,
  alert: WarningRegular,
  question: QuestionRegular,
  shield: SafetyCertificateRegular,
  globe: GlobeRegular,
  lock: LockRegular,
  link: LinkRegular,
  database: ServerRegular,
  bell: NotificationRegular,
  image: PicRegular,
  inbox: InboxRegular,
  layers: LayersRegular,
  sun: SunriseRegular,
  sandglass: SandglassRegular,
  flag: Flag2Regular,
  power: PowerRegular,
  target: TargetRegular,
  chartBar: ChartBarRegular,
  edit: PencilRegular,
  repeat: RepeatRegular,
  undo: HistoryAnticlockwiseRegular,
  pauseCircle: PauseCircleRegular,
  bulb: BulbRegular,
  copy: Copy2Regular,
  keyboard: KeyboardRegular,
  eye: EyeRegular,
  // A skipped start: since when, and the four answers to "What got in the way?".
  history: HistoryRegular,
  mountain: Mountain2Regular,
  battery: Battery1Regular,
  stopwatch: StopwatchRegular,
  search: Search2Regular,
  // Work types, picked by workTypeIcon().
  writing: QuillPenRegular,
  practice: PencilRulerRegular,
  study: BrainRegular,
  reading: Book4Regular,
  quiz: TaskRegular,
  // Subjects, picked from the class name by subjectIcon(). Filled, shown in a tinted square.
  subjectDoc: Document2Filled,
  book: Book2Filled,
  landmark: BankFilled,
  flask: FlaskFilled,
  leaf: LeafFilled,
  atom: ScienceFilled,
  tree: TreeFilled,
  sigma: FormulaFilled,
  languages: TranslateFilled,
  code: CodeFilled,
  palette: PaletteFilled,
  music: MusicFilled,
  heartPulse: Heartbeat2Filled,
  users: GroupFilled,
} satisfies Record<string, ComponentType<IconProps>>;

export type IconName = keyof typeof icons;

// MingCute sets an inline `color: currentColor`, which would beat the CSS rules
// that tint icons. Passing an undefined color drops that inline style.
const cssColor = { color: undefined };

export function Icon({ name, size, label }: { name: IconName; size?: 'sm' | 'xs'; label?: string }) {
  const Glyph = icons[name];
  return <Glyph className={size ? `icon ${size}` : 'icon'} style={cssColor} aria-label={label} />;
}
