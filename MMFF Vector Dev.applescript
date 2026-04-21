-- MMFF Vector Dev launcher
-- Starts/inspects three services: SSH tunnel (localhost:5434), Go backend (:5100), Next.js frontend (:5101).
-- Detects by process name (pgrep -f), verifies liveness by port, and fully detaches children so they
-- survive Terminal/Claude Code exit via `nohup ... & disown` inside a login bash (so Homebrew PATH loads).

property projectRoot : "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM"
property tunnelLog : "/tmp/mmff-tunnel.log"
property serverLog : "/tmp/mmff-server.log"
property nextLog : "/tmp/mmff-next.log"

on runShell(cmd)
	try
		return do shell script cmd
	on error errMsg number errNum
		return ""
	end try
end runShell

on trimWS(s)
	set s to s as text
	repeat while (length of s) > 0 and (s starts with " " or s starts with tab or s starts with linefeed or s starts with return)
		set s to text 2 thru -1 of s
	end repeat
	repeat while (length of s) > 0 and (s ends with " " or s ends with tab or s ends with linefeed or s ends with return)
		set s to text 1 thru -2 of s
	end repeat
	return s
end trimWS

on pidsFor(pattern)
	set raw to my runShell("/usr/bin/pgrep -f " & quoted form of pattern & " || true")
	set raw to my trimWS(raw)
	if raw is "" then return {}
	set AppleScript's text item delimiters to {linefeed, return}
	set parts to text items of raw
	set AppleScript's text item delimiters to ""
	set out to {}
	repeat with p in parts
		set p2 to my trimWS(p as text)
		if p2 is not "" then set end of out to p2
	end repeat
	return out
end pidsFor

on portOpen(port)
	set r to my runShell("/usr/bin/nc -z localhost " & port & " >/dev/null 2>&1 && echo up || echo down")
	return (my trimWS(r)) is "up"
end portOpen

on portListenerPid(port)
	set r to my runShell("/usr/sbin/lsof -nP -iTCP:" & port & " -sTCP:LISTEN -t 2>/dev/null | head -n1 || true")
	return my trimWS(r)
end portListenerPid

on joinPids(pidList)
	set AppleScript's text item delimiters to ", "
	set s to pidList as text
	set AppleScript's text item delimiters to ""
	return s
end joinPids

on killPids(pidList)
	if (count of pidList) is 0 then return
	set pidsStr to ""
	repeat with p in pidList
		set pidsStr to pidsStr & " " & (p as text)
	end repeat
	my runShell("/bin/kill -TERM" & pidsStr & " 2>/dev/null || true")
	delay 3
	my runShell("/bin/kill -KILL" & pidsStr & " 2>/dev/null || true")
end killPids

on tunnelStatus()
	set thePids to my pidsFor("ssh -N.*mmffdev-pg")
	set isUp to my portOpen("5434")
	return {procPids:thePids, isUp:isUp}
end tunnelStatus

on backendStatus()
	set thePids to my pidsFor("go run ./cmd/server")
	if (count of thePids) is 0 then
		set thePids to my pidsFor("cmd/server")
	end if
	set listener to my portListenerPid("5100")
	set isUpFlag to (listener is not "")
	if isUpFlag and (count of thePids) is 0 then set thePids to {listener}
	return {procPids:thePids, isUp:isUpFlag}
end backendStatus

on frontendStatus()
	set thePids to my pidsFor("next dev|next-server")
	set isUpFlag to my portOpen("5101")
	return {procPids:thePids, isUp:isUpFlag}
end frontendStatus

on startTunnel()
	set c to "nohup /usr/bin/ssh -N mmffdev-pg </dev/null >" & tunnelLog & " 2>&1 & disown; echo $!"
	set pidStr to my runShell("/bin/bash -lc " & quoted form of c)
	return my trimWS(pidStr)
end startTunnel

on startBackend()
	set c to "cd " & quoted form of (projectRoot & "/backend") & " && nohup bash -lc 'go run ./cmd/server' </dev/null >" & serverLog & " 2>&1 & disown; echo $!"
	set pidStr to my runShell("/bin/bash -lc " & quoted form of c)
	return my trimWS(pidStr)
end startBackend

on startFrontend()
	set c to "cd " & quoted form of projectRoot & " && : > " & nextLog & " && nohup bash -lc 'npm run dev -- -p 5101' </dev/null >" & nextLog & " 2>&1 & disown; echo $!"
	set pidStr to my runShell("/bin/bash -lc " & quoted form of c)
	return my trimWS(pidStr)
end startFrontend

on waitPortUp(port, maxSecs)
	repeat with i from 1 to maxSecs
		if my portOpen(port) then return true
		delay 1
	end repeat
	return false
end waitPortUp

on waitFrontend(maxSecs)
	repeat with i from 1 to maxSecs
		set r to my runShell("/usr/bin/grep -Eom1 'localhost:[0-9]+' " & nextLog & " 2>/dev/null || true")
		if (my trimWS(r)) is not "" then return true
		delay 1
	end repeat
	return false
end waitFrontend

on describeRunning(tStat, bStat, fStat)
	set msgLines to {}
	if isUp of tStat then set end of msgLines to "Tunnel (5434): up — pids " & my joinPids(procPids of tStat)
	if isUp of bStat then set end of msgLines to "Backend (5100): up — pids " & my joinPids(procPids of bStat)
	if isUp of fStat then set end of msgLines to "Frontend (5101): up — pids " & my joinPids(procPids of fStat)
	set AppleScript's text item delimiters to linefeed
	set s to msgLines as text
	set AppleScript's text item delimiters to ""
	return s
end describeRunning

on run
	set tStat to my tunnelStatus()
	set bStat to my backendStatus()
	set fStat to my frontendStatus()

	set anyUp to (isUp of tStat) or (isUp of bStat) or (isUp of fStat)

	if anyUp then
		set msg to "Already running:" & linefeed & linefeed & my describeRunning(tStat, bStat, fStat) & linefeed & linefeed & "Kill and restart those, leave them running, or cancel?"
		set choice to button returned of (display dialog msg buttons {"Cancel", "Leave running", "Kill and restart"} default button "Leave running" with title "MMFF Vector Dev")
		if choice is "Cancel" then return
		if choice is "Kill and restart" then
			set allPids to {}
			if isUp of tStat then set allPids to allPids & (procPids of tStat)
			if isUp of bStat then set allPids to allPids & (procPids of bStat)
			if isUp of fStat then set allPids to allPids & (procPids of fStat)
			my killPids(allPids)
			delay 1
			set tStat to {procPids:{}, isUp:false}
			set bStat to {procPids:{}, isUp:false}
			set fStat to {procPids:{}, isUp:false}
		end if
	end if

	set tPid to ""
	set bPid to ""
	set fPid to ""
	set tOk to isUp of tStat
	set bOk to isUp of bStat
	set fOk to isUp of fStat

	if not tOk then
		set tPid to my startTunnel()
		set tOk to my waitPortUp("5434", 15)
	else
		if (count of (procPids of tStat)) > 0 then set tPid to (item 1 of (procPids of tStat))
	end if

	if not bOk then
		set bPid to my startBackend()
		set bOk to my waitPortUp("5100", 30)
		if bOk and bPid is "" then set bPid to my portListenerPid("5100")
	else
		if (count of (procPids of bStat)) > 0 then set bPid to (item 1 of (procPids of bStat))
	end if

	if not fOk then
		set fPid to my startFrontend()
		set fOk to my waitFrontend(60)
	else
		if (count of (procPids of fStat)) > 0 then set fPid to (item 1 of (procPids of fStat))
	end if

	set tLine to "Tunnel (localhost:5434): "
	if tOk then
		set tLine to tLine & "up (pid " & tPid & ")"
	else
		set tLine to tLine & "FAILED — see " & tunnelLog
	end if

	set bLine to "Backend (http://localhost:5100): "
	if bOk then
		set bLine to bLine & "up (pid " & bPid & ")"
	else
		set bLine to bLine & "FAILED — see " & serverLog
	end if

	set fLine to "Frontend (http://localhost:5101): "
	if fOk then
		set fLine to fLine & "up (pid " & fPid & ")"
	else
		set fLine to fLine & "FAILED — see " & nextLog
	end if

	set summary to tLine & linefeed & bLine & linefeed & fLine
	display dialog summary buttons {"OK"} default button "OK" with title "MMFF Vector Dev"
end run
