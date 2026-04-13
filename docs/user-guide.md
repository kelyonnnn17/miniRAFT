# miniRAFT User Guide

This guide walks through the browser app from login to drawing and board controls.

## Open The App

1. Start the stack with `docker compose up --build`.
2. Open `http://localhost:3000` in your browser.
3. Enter a user ID and board ID.
4. Select **Enter board** to receive a token and join the collaborative canvas.

## Drawing Tools

- **Pen**: draw normally with the selected ink color.
- **Eraser**: draw white strokes with a thicker brush to remove lines visually.
- **Color swatches**: switch the pen color instantly.
- **Brush slider**: change stroke thickness for both pen and eraser.
- **Clear board**: wipe the canvas for everyone connected to the same board.

## Board Behavior

- Strokes and board clears are replicated through the gateway and committed by the leader.
- Everyone connected to the same board ID sees the same shared canvas state.
- If the active leader changes, the gateway will route future edits to the new leader.

## Tips

- Use the same board ID in multiple browser windows to test collaboration.
- Keep a browser tab open after login so the token remains in local storage.
- Refreshing the page will restore the saved token and reconnect automatically when possible.

## Troubleshooting

- If login fails, make sure the gateway is running and that the browser can reach `http://localhost:8080`.
- If drawing stops, check the status line at the top of the page for a gateway or replica error.
- If the canvas looks stale after a restart, rejoin the board or use the clear-board button to reset the session.