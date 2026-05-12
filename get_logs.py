#!/usr/bin/env python3
import json
import subprocess
import sys
import argparse

def run_ssh_cmd(cmd):
    try:
        result = subprocess.run(["ssh", "evo", cmd], capture_output=True, text=True, check=True)
        return result.stdout.strip()
    except subprocess.CalledProcessError as e:
        print(f"Error running ssh command: {cmd}\n{e.stderr}", file=sys.stderr)
        return None

def main():
    parser = argparse.ArgumentParser(description="Quickly fetch and format logs for the latest Stem Practice Studio run on evo.")
    parser.add_argument("--logs", type=int, default=0, help="Number of docker log lines to tail (default 0)")
    args = parser.parse_args()

    print("🔍 Fetching latest run directory...")
    latest_dir = run_ssh_cmd("ls -td /srv/apps/stem-practice-studio/runs/*/ | head -1")
    if not latest_dir:
        print("❌ Could not find latest run directory.")
        return

    print(f"📂 Latest run: {latest_dir}")
    
    # Fetch manifest
    manifest_raw = run_ssh_cmd(f"cat {latest_dir}manifest.json 2>/dev/null")
    if manifest_raw:
        try:
            manifest = json.loads(manifest_raw)
            print("\n🎵 --- MANIFEST ---")
            print(f"ID:       {manifest.get('id')}")
            print(f"Title:    {manifest.get('title')}")
            print(f"Artist:   {manifest.get('artist')}")
            
            lrc = manifest.get("lrc", {})
            print(f"\n📝 --- LRC FOUND: {lrc.get('found')} ---")
            if lrc.get("found"):
                print(f"LRC Artist: {lrc.get('artist')}")
                print(f"LRC Title:  {lrc.get('title')}")
                
            print("\n⏱️  --- TIMINGS (seconds) ---")
            timings = manifest.get("timings_sec", {})
            for k, v in timings.items():
                print(f"  {k}: {v}")
                
        except json.JSONDecodeError:
            print("❌ Could not parse manifest.json")
    else:
        print("❌ manifest.json not found (still processing?)")

    # Fetch aligned lyrics info
    aligned_raw = run_ssh_cmd(f"cat {latest_dir}lyrics_aligned.json 2>/dev/null")
    if aligned_raw:
        try:
            aligned = json.loads(aligned_raw)
            print("\n🎯 --- ALIGNMENT ---")
            print(f"Model: {aligned.get('model')}")
            print(f"Engine: {aligned.get('engine')}")
            align_stats = aligned.get("alignment")
            if align_stats:
                rate = align_stats.get("match_rate")
                print(f"Match Rate: {rate * 100:.1f}%" if rate else "Match Rate: None")
        except json.JSONDecodeError:
            pass

    # Fetch docker logs if requested
    if args.logs > 0:
        print(f"\n🐳 --- DOCKER LOGS (Last {args.logs} lines) ---")
        logs = run_ssh_cmd(f"docker logs --tail {args.logs} backend-worker-1")
        if logs:
            print(logs)

if __name__ == "__main__":
    main()
