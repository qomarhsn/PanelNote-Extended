/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

// Inspired by the macOS app 'One Thing'
// Extension uses elements from 'Just Another Search Bar' (https://extensions.gnome.org/extension/5522/just-another-search-bar/)

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

function getActiveNote(settings) {
    let now = new Date();
    let nowMinutes = now.getHours() * 60 + now.getMinutes();
    let timeNotes = settings.get_value('time-notes').deep_unpack();

    for (let i = 0; i < timeNotes.length; i++) {
        let [noteText, startHour, startMin, endHour, endMin] = timeNotes[i];
        let rangeStart = startHour * 60 + startMin;
        let rangeEnd = endHour * 60 + endMin;

        let active = rangeStart <= rangeEnd
            ? (nowMinutes >= rangeStart && nowMinutes < rangeEnd)
            : (nowMinutes >= rangeStart || nowMinutes < rangeEnd);

        if (active)
            return {text: noteText || 'No note set', timeNoteIndex: i};
    }

    let defaultNote = settings.get_string('note');
    return {text: defaultNote || 'No note set', timeNoteIndex: -1};
}

const Indicator = GObject.registerClass(
    class Indicator extends PanelMenu.Button {
        _init(settings, uuid) {
            super._init(0.0, _('Panel Note'));
            this._settings = settings;
            this._uuid = uuid;

            /* ------------------------------- Panel Note ------------------------------- */
            let initial = getActiveNote(settings);
            this._activeTimeNoteIndex = initial.timeNoteIndex;
            this.noteInPanel = new St.Label({
                text: initial.text,
                y_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(this.noteInPanel);

            /* ----------------------------- Note Entry Box ----------------------------- */
            this.entry = new St.Entry({
                text: initial.text,
                can_focus: true,
                track_hover: true
            });

            this.entry.set_primary_icon(new St.Icon({
                icon_name: 'document-edit-symbolic',
                style_class: 'popup-menu-icon',
            }));

            this._entryUpdating = false;
            this._textChangedSignal = this.entry.clutter_text.connect('text-changed', () => {
                if (this._entryUpdating) return;
                let text = this.entry.get_text();
                if (text === "")
                    text = "No note set";

                if (this._activeTimeNoteIndex >= 0) {
                    let timeNotes = settings.get_value('time-notes').deep_unpack();
                    timeNotes[this._activeTimeNoteIndex][0] = text;
                    settings.set_value('time-notes', new GLib.Variant('a(siiii)', timeNotes));
                } else {
                    settings.set_string('note', text);
                }
                this._refreshNote();
            });

            this._menuOpenStateChangedId = this.menu.connect('open-state-changed', (_menu, open) => {
                if (open) {
                    let active = getActiveNote(settings);
                    this._activeTimeNoteIndex = active.timeNoteIndex;
                    this._entryUpdating = true;
                    this.entry.set_text(active.text);
                    this._entryUpdating = false;
                }
            });

            let popupEdit = new PopupMenu.PopupMenuSection();
            popupEdit.add_child(this.entry);

            this.menu.addMenuItem(popupEdit);
            this.menu.add_style_class_name('note-entry');

            /* --------------------------- Right-click → Settings --------------------------- */
            // Disable the default ClickGesture so it doesn't consume click events
            this._clickGesture.set_enabled(false);

            // Handle clicks ourselves
            this._buttonPressId = this.connect('button-press-event', (_actor, event) => {
                if (event.get_button() === Clutter.BUTTON_SECONDARY) {
                    this.menu.close();
                    Main.extensionManager.openExtensionPrefs(this._uuid, '', {});
                    return Clutter.EVENT_STOP;
                }
                this.menu.toggle();
                return Clutter.EVENT_STOP;
            });

            /* --------------------------- Auto-refresh timer --------------------------- */
            this._timerId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                30,
                () => {
                    this._refreshNote();
                    return GLib.SOURCE_CONTINUE;
                }
            );
        }

        _refreshNote() {
            let active = getActiveNote(this._settings);
            this._activeTimeNoteIndex = active.timeNoteIndex;
            this.noteInPanel.text = active.text;
        }

        _positionChanged() {
            if (this._settings.get_boolean('enable-positioning')) {
                this.get_parent().remove_child(this);
                let boxes = {
                    0: Main.panel._leftBox,
                    1: Main.panel._centerBox,
                    2: Main.panel._rightBox
                };
                let p = this._settings.get_int('position');
                let i = this._settings.get_int('position-number');
                boxes[p].insert_child_at_index(this, i);
            } else if (this.get_parent() !== Main.panel.statusArea[this._uuid]) {
                Main.panel.addToStatusArea(this._uuid, this);
            }
        }

        destroy() {
            if (this._timerId) {
                GLib.source_remove(this._timerId);
                this._timerId = null;
            }
            if (this._buttonPressId) {
                this.disconnect(this._buttonPressId);
                this._buttonPressId = null;
            }
            if (this._textChangedSignal) {
                this.entry.clutter_text.disconnect(this._textChangedSignal);
                this._textChangedSignal = null;
            }
            if (this._menuOpenStateChangedId) {
                this.menu.disconnect(this._menuOpenStateChangedId);
                this._menuOpenStateChangedId = null;
            }
            super.destroy();
        }
    });

export default class PanelNoteExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new Indicator(this._settings, this.uuid);

        Main.panel.addToStatusArea(this.uuid, this._indicator);

        this._enablePositioningChangedId = this._settings.connect('changed::enable-positioning', this._indicator._positionChanged.bind(this._indicator));
        this._positionChangedId = this._settings.connect('changed::position', this._indicator._positionChanged.bind(this._indicator));
        this._positionNumberChangedId = this._settings.connect('changed::position-number', this._indicator._positionChanged.bind(this._indicator));

        this._noteChangedId = this._settings.connect('changed::note', () => {
            this._indicator._refreshNote();
        });

        this._timeNotesChangedId = this._settings.connect('changed::time-notes', () => {
            this._indicator._refreshNote();
        });

        this._indicator._positionChanged();
    }

    disable() {
        if (this._enablePositioningChangedId) {
            this._settings.disconnect(this._enablePositioningChangedId);
            this._enablePositioningChangedId = null;
        }
        if (this._positionChangedId) {
            this._settings.disconnect(this._positionChangedId);
            this._positionChangedId = null;
        }
        if (this._positionNumberChangedId) {
            this._settings.disconnect(this._positionNumberChangedId);
            this._positionNumberChangedId = null;
        }
        if (this._noteChangedId) {
            this._settings.disconnect(this._noteChangedId);
            this._noteChangedId = null;
        }
        if (this._timeNotesChangedId) {
            this._settings.disconnect(this._timeNotesChangedId);
            this._timeNotesChangedId = null;
        }
        this._indicator.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
