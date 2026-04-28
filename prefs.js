import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";
import Adw from "gi://Adw";

import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

function rangesOverlap(s1, e1, s2, e2) {
    function normalize(s, e) {
        if (s < e) return [[s, e]];
        return [[s, 1440], [0, e]];
    }
    let r1 = normalize(s1, e1);
    let r2 = normalize(s2, e2);
    for (let [a1, b1] of r1) {
        for (let [a2, b2] of r2) {
            if (a1 < b2 && a2 < b1) return true;
        }
    }
    return false;
}

function hasOverlaps(entries) {
    for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
            let s1 = entries[i][1] * 60 + entries[i][2];
            let e1 = entries[i][3] * 60 + entries[i][4];
            let s2 = entries[j][1] * 60 + entries[j][2];
            let e2 = entries[j][3] * 60 + entries[j][4];
            if (rangesOverlap(s1, e1, s2, e2)) return true;
        }
    }
    return false;
}

function is24hFormat() {
    let desktopSettings = new Gio.Settings({ schema_id: "org.gnome.desktop.interface" });
    return desktopSettings.get_string("clock-format") === "24h";
}

// Convert 24h hour to 12h display hour + AM/PM index
function to12h(hour24) {
    let period = hour24 < 12 ? 0 : 1; // 0=AM, 1=PM
    let h12 = hour24 % 12;
    if (h12 === 0) h12 = 12;
    return [h12, period];
}

// Convert 12h display hour + AM/PM back to 24h
function to24h(hour12, period) {
    if (period === 0) // AM
        return hour12 === 12 ? 0 : hour12;
    else // PM
        return hour12 === 12 ? 12 : hour12 + 12;
}

export default class PanelNotePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        let buildable = new Gtk.Builder();
        buildable.add_from_file(this.dir.get_path() + "/prefs.xml");

        let settings = this.getSettings();
        let use24h = is24hFormat();

        // Position bindings
        settings.bind(
            "enable-positioning",
            buildable.get_object("field_enablepositioning"),
            "active",
            Gio.SettingsBindFlags.DEFAULT
        );
        settings.bind(
            "enable-positioning",
            buildable.get_object("row_position_area"),
            "sensitive",
            Gio.SettingsBindFlags.DEFAULT
        );
        settings.bind(
            "enable-positioning",
            buildable.get_object("row_position_index"),
            "sensitive",
            Gio.SettingsBindFlags.DEFAULT
        );
        settings.bind(
            "position",
            buildable.get_object("field_position"),
            "active",
            Gio.SettingsBindFlags.DEFAULT
        );
        settings.bind(
            "position-number",
            buildable.get_object("field_positionnumber"),
            "value",
            Gio.SettingsBindFlags.DEFAULT
        );

        // Main note
        settings.bind(
            "note",
            buildable.get_object("field_main_note"),
            "text",
            Gio.SettingsBindFlags.DEFAULT
        );

        // Time-based notes
        let groupTimeNotes = buildable.get_object("group_time_notes");
        let rowWidgets = [];
        let isUpdating = false;

        let addButton = new Gtk.Button({
            label: "Add Scheduled Note",
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
            margin_top: 6,
            margin_bottom: 6,
        });
        groupTimeNotes.add(addButton);

        function saveAllRows() {
            if (isUpdating) return;
            isUpdating = true;

            let entries = rowWidgets.map(w => w.getValues());

            if (hasOverlaps(entries)) {
                for (let w of rowWidgets) {
                    w.row.add_css_class("error");
                }
                isUpdating = false;
                return;
            }

            for (let w of rowWidgets) {
                w.row.remove_css_class("error");
            }

            let variant = new GLib.Variant("a(siiii)", entries);
            settings.set_value("time-notes", variant);
            isUpdating = false;
        }

        function makeHourSpin(lower, upper, value) {
            return new Gtk.SpinButton({
                adjustment: new Gtk.Adjustment({ lower, upper, step_increment: 1 }),
                value,
                numeric: true,
                wrap: true,
            });
        }

        function makeMinSpin(value) {
            return new Gtk.SpinButton({
                adjustment: new Gtk.Adjustment({ lower: 0, upper: 59, step_increment: 1 }),
                value,
                numeric: true,
                wrap: true,
            });
        }

        function makePeriodCombo(activeIdx) {
            let combo = new Gtk.ComboBoxText();
            combo.append("am", "AM");
            combo.append("pm", "PM");
            combo.set_active_id(activeIdx === 1 ? "pm" : "am");
            return combo;
        }

        function buildTimeNoteRow(index, entryData) {
            let row = new Adw.ExpanderRow({
                title: `Scheduled Note ${index + 1}`,
            });

            // Note text entry
            let noteEntry = new Gtk.Entry({
                text: entryData[0] || "",
                hexpand: true,
                placeholder_text: "Enter note text…",
            });

            let noteRow = new Adw.ActionRow({ title: "Note Text" });
            noteRow.add_suffix(noteEntry);
            row.add_row(noteRow);

            // Start time
            let startHour24 = entryData[1] || 9;
            let startMin = entryData[2] || 0;
            let startHourSpin, startPeriodCombo;

            if (use24h) {
                startHourSpin = makeHourSpin(0, 23, startHour24);
            } else {
                let [h12, period] = to12h(startHour24);
                startHourSpin = makeHourSpin(1, 12, h12);
                startPeriodCombo = makePeriodCombo(period);
            }
            let startMinSpin = makeMinSpin(startMin);

            let startBox = new Gtk.Box({ spacing: 4, halign: Gtk.Align.END });
            startBox.append(startHourSpin);
            startBox.append(new Gtk.Label({ label: ":" }));
            startBox.append(startMinSpin);
            if (!use24h) startBox.append(startPeriodCombo);

            let startRow = new Adw.ActionRow({ title: "Starts At" });
            startRow.add_suffix(startBox);
            row.add_row(startRow);

            // End time
            let endHour24 = entryData[3] || 17;
            let endMin = entryData[4] || 0;
            let endHourSpin, endPeriodCombo;

            if (use24h) {
                endHourSpin = makeHourSpin(0, 23, endHour24);
            } else {
                let [h12, period] = to12h(endHour24);
                endHourSpin = makeHourSpin(1, 12, h12);
                endPeriodCombo = makePeriodCombo(period);
            }
            let endMinSpin = makeMinSpin(endMin);

            let endBox = new Gtk.Box({ spacing: 4, halign: Gtk.Align.END });
            endBox.append(endHourSpin);
            endBox.append(new Gtk.Label({ label: ":" }));
            endBox.append(endMinSpin);
            if (!use24h) endBox.append(endPeriodCombo);

            let endRow = new Adw.ActionRow({ title: "Ends At" });
            endRow.add_suffix(endBox);
            row.add_row(endRow);

            // Remove button
            let removeButton = new Gtk.Button({
                label: "Remove Note",
                css_classes: ["destructive-action"],
                halign: Gtk.Align.END,
                margin_top: 6,
                margin_bottom: 6,
            });

            let removeRow = new Adw.ActionRow();
            removeRow.add_suffix(removeButton);
            row.add_row(removeRow);

            removeButton.connect("clicked", () => {
                groupTimeNotes.remove(row);
                rowWidgets = rowWidgets.filter(w => w.row !== row);
                saveAllRows();
            });

            // Connect change signals
            noteEntry.connect("changed", () => saveAllRows());
            startHourSpin.connect("value-changed", () => saveAllRows());
            startMinSpin.connect("value-changed", () => saveAllRows());
            endHourSpin.connect("value-changed", () => saveAllRows());
            endMinSpin.connect("value-changed", () => saveAllRows());
            if (!use24h) {
                startPeriodCombo.connect("changed", () => saveAllRows());
                endPeriodCombo.connect("changed", () => saveAllRows());
            }

            function getHour24(spin, combo) {
                let h = spin.get_value_as_int();
                if (use24h) return h;
                let period = combo.get_active_id() === "pm" ? 1 : 0;
                return to24h(h, period);
            }

            return {
                row,
                getValues: () => [
                    noteEntry.get_text(),
                    getHour24(startHourSpin, startPeriodCombo),
                    startMinSpin.get_value_as_int(),
                    getHour24(endHourSpin, endPeriodCombo),
                    endMinSpin.get_value_as_int(),
                ],
            };
        }

        function rebuildList() {
            for (let w of rowWidgets) {
                groupTimeNotes.remove(w.row);
            }
            rowWidgets = [];

            let entries = settings.get_value("time-notes").deep_unpack();

            isUpdating = true;
            for (let i = 0; i < entries.length; i++) {
                let widget = buildTimeNoteRow(i, entries[i]);
                groupTimeNotes.remove(addButton);
                groupTimeNotes.add(widget.row);
                groupTimeNotes.add(addButton);
                rowWidgets.push(widget);
            }
            isUpdating = false;
        }

        addButton.connect("clicked", () => {
            let current = settings.get_value("time-notes").deep_unpack();
            current.push(["", 9, 0, 17, 0]);
            let variant = new GLib.Variant("a(siiii)", current);
            settings.set_value("time-notes", variant);
            rebuildList();
        });

        settings.connect("changed::time-notes", () => {
            if (!isUpdating) rebuildList();
        });

        rebuildList();

        window.search_enabled = true;
        window.add(buildable.get_object("page_basic"));
    }
}
