import flet as ft
import instaloader
import json
import os
import threading
import time
import random
import browser_cookie3
from datetime import datetime

# --- CONFIGURATION ---
APP_NAME = "ERTHRAUS | IG Analytics Pro"
DATA_FILE_SUFFIX = "_data.json"
SESSION_FILE_PREFIX = "session_"
ASSETS_DIR = "assets"

if not os.path.exists(ASSETS_DIR):
    os.makedirs(ASSETS_DIR)

# --- BACKEND LOGIC CLASS ---
class InstaBackend:
    def __init__(self, log_callback, progress_callback):
        self.log = log_callback
        self.set_progress = progress_callback
        self.L = instaloader.Instaloader(
            sleep=True,
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            max_connection_attempts=5,
            request_timeout=90.0
        )
        self.is_processing = False

    def get_session_file(self, username):
        return f"{SESSION_FILE_PREFIX}{username}"

    def load_firefox_cookies(self, username):
        try:
            self.log("Reading Firefox cookies...", error=False)
            cookies = browser_cookie3.firefox(domain_name='instagram.com')
            self.L.context._session.cookies = cookies
            self.L.context.username = username
            self.L.save_session_to_file(filename=self.get_session_file(username))
            self.log("Cookies imported successfully!", error=False)
            return True
        except Exception as e:
            self.log(f"Cookie Import Failed: {e}", error=True)
            return False

    def _check_account_status(self, username: str) -> str:
        """Returns 'active', 'deactivated', 'deleted', or 'unknown'."""
        try:
            p = instaloader.Profile.from_username(self.L.context, username)
            if p.mediacount == 0 and p.followers == 0 and p.followees == 0:
                return "deactivated"
            return "active"
        except instaloader.exceptions.ProfileNotExistsException:
            return "deleted"
        except Exception:
            return "unknown"

    def run_update(self, username, password, on_complete):
        """Runs the main analysis logic in a background thread."""
        if self.is_processing: return
        self.is_processing = True
        
        def _thread_target():
            try:
                self.set_progress(None) # Indeterminate mode (spinning)
                session_file = self.get_session_file(username)

                # 1. LOGIN
                try:
                    if os.path.exists(session_file):
                        self.log("Restoring session...")
                        self.L.load_session_from_file(username, filename=session_file)
                    elif password:
                        self.log("Logging in with password...")
                        self.L.login(username, password)
                    else:
                        raise Exception("No session found. Enter password or use Firefox Import.")
                    
                    self.log("Login successful. Warming up...")
                    self.L.save_session_to_file(filename=session_file)
                    time.sleep(random.uniform(3, 6)) # Safety pause

                except Exception as e:
                    self.log(f"Login Error: {e}", error=True)
                    return

                # 2. FETCH DATA
                self.set_progress(0.1)
                self.log("Fetching Profile...")
                profile = instaloader.Profile.from_username(self.L.context, username)

                # Fetcher Helper
                def fetch_users(iterator, label, start_prog, end_prog):
                    res = {}
                    count = 0
                    self.log(f"Fetching {label}...")
                    for person in iterator:
                        res[person.username] = {
                            "username": person.username,
                            "full_name": person.full_name,
                            "pic": person.profile_pic_url
                        }
                        count += 1
                        if count % 10 == 0:
                            self.log(f"{label}: {count} fetched")
                    return res

                # Get Followers
                followers_dict = fetch_users(profile.get_followers(), "Followers", 0.1, 0.5)
                self.set_progress(0.5)
                
                self.log("Cooling down connection (safety pause)...")
                time.sleep(8 + random.uniform(1, 4))

                # Get Following
                following_dict = fetch_users(profile.get_followees(), "Following", 0.5, 0.9)
                self.set_progress(0.9)

                # 3. ANALYSIS
                self.log("Analyzing connections...")
                current_followers = set(followers_dict.keys())
                current_following = set(following_dict.keys())

                not_back = current_following - current_followers
                fans = current_followers - current_following
                lost = set()
                new = set()

                # History Comparison
                data_file = f"{username}{DATA_FILE_SUFFIX}"
                full_map = {**followers_dict, **following_dict}
                old_stats = {}

                if os.path.exists(data_file):
                    try:
                        with open(data_file, "r") as f:
                            history = json.load(f)
                            old_followers = set(history.get("followers_list", []))
                            old_map = history.get("full_map", {})
                            old_stats = history.get("stats", {})

                            lost = old_followers - current_followers
                            new = current_followers - old_followers

                            # Preserve lost user data
                            for u in lost:
                                if u in old_map: full_map[u] = old_map[u]
                    except Exception as e:
                        print(f"History load error: {e}")

                # 4. DEACTIVATED ACCOUNT CHECK
                old_deactivated = set(old_stats.get("deactivated", []))
                old_true_lost = set(old_stats.get("lost", []))

                # Re-use previous classifications; only check newly lost users
                still_deactivated = lost & old_deactivated
                still_lost = lost & old_true_lost
                newly_lost = lost - old_deactivated - old_true_lost

                pending_check = []
                if len(newly_lost) > 50:
                    newly_lost_list = list(newly_lost)
                    pending_check = newly_lost_list[50:]
                    newly_lost = set(newly_lost_list[:50])

                true_lost = set(still_lost)
                deactivated_list = set(still_deactivated)

                if newly_lost:
                    self.log(f"Checking {len(newly_lost)} new lost account(s) for deactivation...")
                    for i, u in enumerate(newly_lost):
                        self.log(f"Checking: {u} ({i+1}/{len(newly_lost)})")
                        self.set_progress(0.9 + (i / len(newly_lost)) * 0.08)
                        status = self._check_account_status(u)
                        if status == "active":
                            true_lost.add(u)
                        else:
                            deactivated_list.add(u)
                        time.sleep(random.uniform(2.5, 4.0))

                # Unchecked pending users treated as lost until next run
                true_lost.update(pending_check)

                # 5. SAVE
                save_data = {
                    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "full_map": full_map,
                    "followers_list": list(current_followers),
                    "following_list": list(current_following),
                    "stats": {
                        "lost": list(true_lost),
                        "not_back": list(not_back),
                        "new": list(new),
                        "fans": list(fans),
                        "deactivated": list(deactivated_list)
                    }
                }

                with open(data_file, "w") as f:
                    json.dump(save_data, f)

                self.log("Analysis Complete!", error=False)
                self.set_progress(1.0)
                on_complete() # Trigger UI reload

            except Exception as e:
                self.log(f"Critical Error: {e}", error=True)
            finally:
                self.is_processing = False
                self.set_progress(0)

        threading.Thread(target=_thread_target, daemon=True).start()

# --- UI COMPONENTS ---

def main(page: ft.Page):
    page.title = APP_NAME
    page.theme_mode = "DARK"  # String constant
    page.padding = 0
    page.window_width = 1200
    page.window_height = 800

    # -- STATE --
    current_username = ft.Ref[ft.TextField]()
    current_password = ft.Ref[ft.TextField]()
    
    # -- GUI HELPERS --
    def show_snack(message, is_error=False):
        color = "error" if is_error else "green"
        page.snack_bar = ft.SnackBar(
            content=ft.Text(message), 
            bgcolor=color
        )
        page.snack_bar.open = True
        page.update()

    def update_log(msg, error=False):
        log_text.value = f"Status: {msg}"
        log_text.color = "red400" if error else "grey400"
        if error: show_snack(msg, True)
        page.update()

    def update_progress(val):
        progress_bar.value = val
        page.update()

    # -- BACKEND INSTANCE --
    backend = InstaBackend(update_log, update_progress)

    # -- WIDGETS --
    log_text = ft.Text("Status: Ready", size=12, color="grey400")
    progress_bar = ft.ProgressBar(value=0, visible=True, height=4, color="blue")
    
    # Container for the grid
    content_area = ft.Container(padding=20, expand=True)

    # User Card Component
    def create_user_card(username, full_name, pic_url):
        return ft.Container(
            content=ft.Row([
                ft.CircleAvatar(
                    foreground_image_url=pic_url if pic_url else "",
                    content=ft.Text(username[0].upper()) if not pic_url else None,
                    radius=24
                ),
                ft.Column([
                    ft.Text(username, weight="bold", size=14),
                    ft.Text(full_name[:20], size=12, color="grey400"),
                ], spacing=2, expand=True),
                ft.IconButton(
                    icon="open_in_new", 
                    tooltip="Open Profile",
                    on_click=lambda _: page.launch_url(f"https://instagram.com/{username}")
                )
            ], alignment="start"),
            padding=10,
            border_radius=10,
            bgcolor="surfaceVariant", 
        )

    # Main Grid for Results
    result_grids = {
        "lost": ft.GridView(expand=True, runs_count=5, max_extent=300, child_aspect_ratio=3, spacing=10, run_spacing=10),
        "not_back": ft.GridView(expand=True, runs_count=5, max_extent=300, child_aspect_ratio=3, spacing=10, run_spacing=10),
        "new": ft.GridView(expand=True, runs_count=5, max_extent=300, child_aspect_ratio=3, spacing=10, run_spacing=10),
        "fans": ft.GridView(expand=True, runs_count=5, max_extent=300, child_aspect_ratio=3, spacing=10, run_spacing=10),
        "deactivated": ft.GridView(expand=True, runs_count=5, max_extent=300, child_aspect_ratio=3, spacing=10, run_spacing=10),
    }

    # Data Loader
    def load_data_into_ui():
        user = current_username.current.value
        path = f"{user}{DATA_FILE_SUFFIX}"
        
        if not os.path.exists(path):
            update_log("No cached data found.", True)
            return

        with open(path, "r") as f:
            data = json.load(f)
        
        full_map = data.get("full_map", {})
        stats = data.get("stats", {})

        for category, grid in result_grids.items():
            grid.controls.clear()
            users = stats.get(category, [])
            
            # Header
            grid.controls.append(ft.Container(content=ft.Text(f"Total: {len(users)}", color="grey"), col=1))
            
            for u in users:
                info = full_map.get(u, {"username": u, "full_name": "", "pic": ""})
                grid.controls.append(create_user_card(info["username"], info.get("full_name", ""), info.get("pic", "")))
        
        # Default view
        switch_view("lost")

    # View Switcher (Replaces Tabs)
    def switch_view(category):
        content_area.content = result_grids[category]
        # Highlight active button visually (optional simple logic)
        page.update()

    # -- ACTION HANDLERS --
    def on_login_click(e):
        backend.run_update(current_username.current.value, current_password.current.value, load_data_into_ui)

    def on_firefox_click(e):
        if backend.load_firefox_cookies(current_username.current.value):
            show_snack("Firefox cookies imported!")

    def on_load_cache_click(e):
        load_data_into_ui()

    # -- SIDEBAR --
    sidebar = ft.Container(
        width=300,
        bgcolor="background", 
        padding=20,
        content=ft.Column([
            ft.Text("IG ANALYTICS PRO", size=24, weight="bold", color="blue"),
            ft.Divider(height=20, color="transparent"),
            
            ft.Text("Account Details", size=12, weight="bold", color="grey"),
            
            ft.TextField(ref=current_username, label="Username", prefix_icon="person"),
            ft.TextField(ref=current_password, label="Password", password=True, can_reveal_password=True, prefix_icon="lock"),
            
            ft.Divider(height=20),
            
            ft.FilledButton("Update Data", icon="refresh", on_click=on_login_click, height=50, style=ft.ButtonStyle(bgcolor="blue", color="white")),
            ft.OutlinedButton("Load Cached Data", icon="folder_open", on_click=on_load_cache_click),
            
            ft.Divider(height=20),
            ft.FilledButton("Import Firefox Cookies", icon="local_shipping", on_click=on_firefox_click, style=ft.ButtonStyle(bgcolor="orange800")),
            
            ft.Divider(),
            progress_bar,
            log_text,
        ], spacing=15)
    )

    # -- TOP MENU (Replaces Tabs) --
    # We use simple buttons to switch the content. This is 100% reliable.
    menu_row = ft.Row(
        [
            ft.ElevatedButton("Unfollowers (Lost)", icon="remove_circle_outline", on_click=lambda _: switch_view("lost"), bgcolor="surfaceVariant", color="white"),
            ft.ElevatedButton("Not Following Back", icon="warning_amber", on_click=lambda _: switch_view("not_back"), bgcolor="surfaceVariant", color="white"),
            ft.ElevatedButton("New Followers", icon="add_circle_outline", on_click=lambda _: switch_view("new"), bgcolor="surfaceVariant", color="white"),
            ft.ElevatedButton("Fans", icon="favorite", on_click=lambda _: switch_view("fans"), bgcolor="surfaceVariant", color="white"),
            ft.ElevatedButton("Frozen / Deleted", icon="ac_unit", on_click=lambda _: switch_view("deactivated"), bgcolor="surfaceVariant", color="white"),
        ],
        scroll="always"
    )

    # -- LAYOUT --
    page.add(
        ft.Row(
            [
                sidebar,
                ft.VerticalDivider(width=1),
                ft.Column([
                    ft.Container(menu_row, padding=10, height=60), # Top Menu
                    content_area # Main Grid
                ], expand=True)
            ],
            expand=True,
            spacing=0
        )
    )
    
    if current_username.current.value:
        load_data_into_ui()

if __name__ == "__main__":
    # Use standard 'target' but with 'ft.app' which is universally available
    ft.app(target=main)