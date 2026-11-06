# Record a short demo of the model health dialog.
#
# From the repository root:
#   vhs docs/demo.tape
#
# Use a provider with a small model list (5-15 models) so the GIF stays short
# and the scan finishes quickly. The scan makes real billed requests.

Output docs/demo.gif

Set Shell "bash"
Set FontSize 16
Set Width 1200
Set Height 720
Set Padding 24
Set Theme "Dracula"
Set TypingSpeed 50ms
Set CursorBlink false

Type "opencode"
Enter
Sleep 8s

# Slash command works regardless of the configured leader key.
Type "/models-health"
Sleep 1s
Enter
Sleep 20s

# Open the first model's details, return to the list, then close.
Enter
Sleep 4s
Escape
Sleep 2s
Escape
Sleep 2s