import CommandPalette from "./CommandPalette";
import ShortcutCheatSheet from "./ShortcutCheatSheet";
import QuickAddChart from "./QuickAddChart";
import KeyboardHintBar from "./KeyboardHintBar";
import type { Dimension, Measure, ChartType } from "../../lib/dashboard/types";
import type { useDashboardPowerKeys } from "../../hooks/useDashboardPowerKeys";

type PowerKeysReturn = ReturnType<typeof useDashboardPowerKeys>;

interface Props {
  powerKeys: PowerKeysReturn;
  isBuilder: boolean;
  onQuickAdd: (config: { dimension: Dimension; measure: Measure; chartType: ChartType }) => void;
}

/**
 * DashboardKeyboardLayer — renders all keyboard-related UI overlays.
 *
 * Drop this component into StatsPage and pass the return value of
 * useDashboardPowerKeys(). It renders:
 *  - Command Palette dialog
 *  - Shortcut Cheat Sheet dialog
 *  - Quick Add Chart dialog
 *  - Keyboard Hint Bar (floating bottom)
 *  - Screen reader live region for announcements
 */
export default function DashboardKeyboardLayer({ powerKeys, isBuilder, onQuickAdd }: Props) {
  const { palette, showCheatSheet, setShowCheatSheet, showQuickAdd, setShowQuickAdd, registry, keyboardActive, announcement, gridNav } = powerKeys;

  return (
    <>
      {/* Screen reader announcements */}
      <div
        role="status"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </div>

      {/* Command Palette */}
      <CommandPalette
        isOpen={palette.isOpen}
        query={palette.query}
        onQueryChange={palette.setQuery}
        results={palette.filteredResults}
        selectedIndex={palette.selectedIndex}
        onSelect={palette.setSelectedIndex}
        onExecute={palette.execute}
        onMoveSelection={palette.moveSelection}
        onClose={palette.close}
      />

      {/* Shortcut Cheat Sheet */}
      <ShortcutCheatSheet
        isOpen={showCheatSheet}
        onClose={() => setShowCheatSheet(false)}
        remaps={registry.remaps}
        onRemap={registry.remap}
        onResetRemap={registry.resetRemap}
        onResetAll={registry.resetAll}
      />

      {/* Quick Add Chart */}
      <QuickAddChart
        isOpen={showQuickAdd}
        onClose={() => setShowQuickAdd(false)}
        onAdd={onQuickAdd}
      />

      {/* Keyboard Hint Bar */}
      <KeyboardHintBar
        chartFocused={gridNav.focusedIndex !== null}
        isBuilder={isBuilder}
        visible={keyboardActive && !palette.isOpen && !showCheatSheet && !showQuickAdd}
      />
    </>
  );
}
