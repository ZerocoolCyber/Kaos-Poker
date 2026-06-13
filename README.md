# ♠ Kaos Theory Poker

**LAN Texas Hold'em Poker — No-Limit, up to 8 players**

---

## Requirements

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- Windows 10/11

---

## Setup (First Time Only)

1. **Extract** this ZIP to a folder, e.g. `C:\KaosPoker\`

2. **Open Command Prompt** in that folder:
   - Hold `Shift`, right-click the folder → *"Open PowerShell window here"*
   - Or press `Win + R`, type `cmd`, navigate with `cd C:\KaosPoker`

3. **Install dependencies:**
   ```
   npm install
   ```

---

## Running the Server

```
npm start
```

You'll see:
```
♠ Kaos Theory Poker server running at http://localhost:3000
  Share your LAN IP so others can join, e.g. http://192.168.x.x:3000
```

**Find your LAN IP (to share with other players):**
- Open Command Prompt and type: `ipconfig`
- Look for **IPv4 Address** under your WiFi or Ethernet adapter
- Example: `192.168.1.42`
- Other players open their browser and go to: `http://192.168.1.42:3000`

---

## How to Play

### Host (the person running the server)

1. Open `http://localhost:3000` in your browser
2. Click **Create Game**
3. Configure your game:
   - **Game Mode**: LAN (each player on own device) or Hot-Seat (shared screen)
   - **Game Type**: Cash Game (fixed blinds) or Tournament (blinds increase on a timer)
   - **Starting Chips**, **Blinds**, **Max Players**
   - **Rebuys**: Toggle on/off and set rebuy amount
4. Click **Create Game** — you'll be taken to the table
5. Share the **6-character game code** shown top-right with other players
6. Once everyone has joined, click **▶ Start Hand**

### Players (joining via LAN)

1. Open the server address in your browser (e.g. `http://192.168.1.42:3000`)
2. Click **Join Game**
3. Enter your name and the 6-character game code
4. Click **Join Game** — you're at the table!

### Spectators

- Join as normal but toggle **"Join as Spectator"** before clicking Join

---

## Game Rules (No-Limit Texas Hold'em)

| Phase | Description |
|-------|-------------|
| **Pre-Flop** | Each player receives 2 hole cards (private). Blinds posted. Betting begins left of Big Blind. |
| **Flop** | 3 community cards dealt face-up. Betting begins left of dealer. |
| **Turn** | 1 more community card. Another betting round. |
| **River** | Final community card. Final betting round. |
| **Showdown** | Remaining players reveal cards. Best 5-card hand wins. |

**Actions available:** Fold · Check · Call · Raise · All-In

**Hand rankings** (best to worst):
Royal Flush → Straight Flush → Four of a Kind → Full House → Flush → Straight → Three of a Kind → Two Pair → One Pair → High Card

---

## Privacy (LAN Mode)

Each player's **hole cards are only sent to their own browser session** — the server never sends your cards to anyone else. Other players see card backs on the table.

---

## Tournament Mode

- Blinds automatically increase on a configurable timer (default: 15 minutes per level)
- A countdown timer is shown in the top header
- Blind levels are fully configurable when creating the game

---

## Troubleshooting

**"Cannot connect" / page not loading on other devices:**
- Make sure your firewall allows connections on port 3000
- Windows Defender Firewall → Allow an app → Add `node.exe`
- Or run: `netsh advfirewall firewall add rule name="KaosPoker" dir=in action=allow protocol=TCP localport=3000`

**"Game not found" error:**
- Double-check the 6-character game code (case-insensitive)
- Make sure the host's server is still running

**Port already in use:**
- Change the port by running: `set PORT=3001 && npm start`
- Then players connect to port 3001

---

## File Structure

```
kaos-poker/
├── server.js          — Main server (Express + Socket.io)
├── package.json       — Dependencies
├── src/
│   └── game.js        — Poker engine (deck, hand eval, game state)
└── public/
    ├── index.html     — Lobby / Create & Join
    ├── game.html      — Game table
    └── images/
        └── logo.png   — Kaos Theory Poker logo
```

---

*Built for Kaos Theory Poker — No-Limit Texas Hold'em on your LAN*
