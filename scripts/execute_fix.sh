#!/bin/bash

# Execute the fix for workout exercises in production
# This script will authenticate and call the fix endpoint

set -e

API_URL="${API_URL:-https://stoic-fit.com/api}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

echo "🔧 Exercise Fix Execution Script"
echo "================================"
echo ""

# Function to get admin token
get_admin_token() {
    if [ -z "$ADMIN_EMAIL" ] || [ -z "$ADMIN_PASSWORD" ]; then
        echo "❌ Error: ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required"
        echo ""
        echo "Usage:"
        echo "  ADMIN_EMAIL=your@email.com ADMIN_PASSWORD=yourpassword ./scripts/execute_fix.sh"
        echo ""
        exit 1
    fi

    echo "🔐 Authenticating as admin..."
    
    response=$(curl -s -X POST "${API_URL}/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}")
    
    token=$(echo "$response" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('token', ''))" 2>/dev/null || echo "")
    
    if [ -z "$token" ]; then
        error=$(echo "$response" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('error', 'Unknown error'))" 2>/dev/null || echo "Authentication failed")
        echo "❌ Authentication failed: $error"
        exit 1
    fi
    
    echo "✅ Authentication successful"
    echo "$token"
}

# Function to verify admin role
verify_admin() {
    local token=$1
    
    echo "👤 Verifying admin access..."
    
    user_info=$(curl -s -X GET "${API_URL}/auth/me" \
        -H "Authorization: Bearer ${token}")
    
    role=$(echo "$user_info" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('user', {}).get('role', ''))" 2>/dev/null || echo "")
    
    if [ "$role" != "admin" ]; then
        echo "❌ Error: User does not have admin role (current role: ${role})"
        exit 1
    fi
    
    echo "✅ Admin access verified"
}

# Function to execute the fix
execute_fix() {
    local token=$1
    
    echo ""
    echo "🚀 Executing exercise fix..."
    echo ""
    
    response=$(curl -s -X POST "${API_URL}/admin/workouts/fix-exercises" \
        -H "Authorization: Bearer ${token}" \
        -H "Content-Type: application/json")
    
    # Check if response is valid JSON
    if echo "$response" | python3 -c "import sys, json; json.load(sys.stdin)" 2>/dev/null; then
        echo "$response" | python3 -m json.tool
        echo ""
        
        success=$(echo "$response" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('success', False))" 2>/dev/null || echo "false")
        
        if [ "$success" = "True" ]; then
            workouts_fixed=$(echo "$response" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('workoutsFixed', 0))" 2>/dev/null || echo "0")
            total_fixes=$(echo "$response" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('totalFixes', 0))" 2>/dev/null || echo "0")
            
            echo "✅ Fix completed successfully!"
            echo "   - Workouts fixed: ${workouts_fixed}"
            echo "   - Total fixes applied: ${total_fixes}"
            
            # Show log if available
            log=$(echo "$response" | python3 -c "import sys, json; data=json.load(sys.stdin); print('\\n'.join(data.get('log', [])))" 2>/dev/null || echo "")
            if [ -n "$log" ]; then
                echo ""
                echo "📋 Fix Log:"
                echo "$log"
            fi
        else
            error=$(echo "$response" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('error', 'Unknown error'))" 2>/dev/null || echo "Unknown error")
            echo "❌ Fix failed: $error"
            exit 1
        fi
    else
        echo "❌ Invalid response from server:"
        echo "$response"
        exit 1
    fi
}

# Main execution
main() {
    # Get admin token
    TOKEN=$(get_admin_token)
    
    # Verify admin role
    verify_admin "$TOKEN"
    
    # Execute the fix
    execute_fix "$TOKEN"
    
    echo ""
    echo "✅ All done! Exercise fixes have been applied to production."
}

# Run main function
main



















