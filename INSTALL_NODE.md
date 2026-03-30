# Quick Start - Node.js Installation

## You see "command not found" for npm?

This means Node.js isn't installed yet. Here are the easiest ways to install it:

## ⚡ Quickest Method: Official Installer

1. **Open your web browser** and go to: https://nodejs.org/
2. **Click the big green "Download" button** (LTS version)
3. **Run the downloaded `.pkg` file**
4. **Follow the installation wizard** (just click "Continue" through the steps)
5. **Close and reopen your terminal**
6. **Verify it worked**:
   ```bash
   node --version
   npm --version
   ```
   You should see version numbers like `v20.10.0` and `10.2.3`

7. **Now you can run**:
   ```bash
   cd "/Users/jamey/Documents/Stoic Shop"
   npm install
   ```

## Alternative: Using Homebrew (if you're comfortable with command line)

If you want to use Homebrew (macOS package manager):

1. **Install Homebrew** (copy and paste this entire command):
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```
   - You'll be asked for your Mac password
   - Follow the prompts

2. **After Homebrew installs**, install Node.js:
   ```bash
   brew install node
   ```

3. **Verify**:
   ```bash
   node --version
   npm --version
   ```

## After Installing Node.js

Once Node.js is installed, come back to the project directory and run:

```bash
npm install
```

This will install all the project dependencies listed in `package.json`.

Then you can test the server locally:

```bash
npm run dev
```

Visit `http://localhost:3000` to see if it's working!

## Need Help?

If you run into issues:
- Make sure you closed and reopened your terminal after installing Node.js
- Try typing `node --version` to verify Node.js is accessible
- Check that you're in the correct directory: `/Users/jamey/Documents/Stoic Shop`

