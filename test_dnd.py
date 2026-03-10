import customtkinter as ctk
from tkinterdnd2 import TkinterDnD, DND_FILES

class Tk(ctk.CTk, TkinterDnD.DnDWrapper):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.TkdndVersion = TkinterDnD._require(self)

app = Tk()
app.geometry("200x200")

def drop(event):
    print(f"Dropped: {event.data}")

app.drop_target_register(DND_FILES)
app.dnd_bind('<<Drop>>', drop)
print("SUCCESS")
app.after(500, app.destroy)
app.mainloop()
