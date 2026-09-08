#!/bin/bash
# Seeds the real T VANAMM menu into the local billing DB via the admin API,
# then publishes it to the Demo Outlet. Requires admin-web running on :3000.
set -eu

BASE=http://localhost:3000
J=$(mktemp)
BRAND=01000000-0000-4000-8000-000000000010
OUTLET=22222222-2222-4222-8222-222222222222

echo "== login =="
curl -s -c "$J" -b "$J" -H "origin:$BASE" -X POST "$BASE/api/v1/auth/otp/request" -H 'content-type: application/json' -d '{"phone":"+919000000001"}' >/dev/null
curl -s -c "$J" -b "$J" -H "origin:$BASE" -X POST "$BASE/api/v1/auth/otp/verify"  -H 'content-type: application/json' -d '{"phone":"+919000000001","code":"123456"}' >/dev/null

ORDER=0
section() { # section "Name"  "Item=Price" "Item=Price" ...
  local name="$1"; shift
  local cid
  cid=$(curl -s -b "$J" -H "origin:$BASE" -X POST "$BASE/api/v1/catalog/categories" \
    -H 'content-type: application/json' \
    -d "{\"brandId\":\"$BRAND\",\"name\":\"$name\",\"displayOrder\":$ORDER}" \
    | sed -E 's/.*"(id|categoryId)":"([0-9a-f-]+)".*/\2/')
  ORDER=$((ORDER+1))
  local pair n p
  for pair in "$@"; do
    n="${pair%=*}"; p="${pair#*=}"
    curl -s -b "$J" -H "origin:$BASE" -X POST "$BASE/api/v1/catalog/items" \
      -H 'content-type: application/json' \
      -d "{\"brandId\":\"$BRAND\",\"categoryId\":\"$cid\",\"name\":\"$n\",\"price\":\"$p\",\"gstRate\":\"5\"}" >/dev/null
    printf '.'
  done
  echo " $name ($cid)"
}

section "Hot Beverages" \
  "Dum Chai=20" "Elachi Tea=25" "Ginger Tea=25" "Kadak Chai=25" "Lemon Tea=25" \
  "Green Tea=25" "Black Tea=25" "Badam Tea=30" "Pepper Tea=30" "Sonti Tea=30" \
  "Bellam Tea=35" "Coffee=25" "Black Coffee=25" "Cold Coffee=95" "Bullet Coffee=70" \
  "Boost=30" "Horlicks=30" "Badam Milk=55" "Rose Milk=60" "Chocolate Milk=45" \
  "Pepper Milk=30" "Sonti Milk=30" "Bellam Coffee=30" "Filter Coffee=30"

section "Special Coffees" \
  "Butterscotch=88" "Caramel=88" "Hazelnut=89"

section "Herbal Teas" \
  "Hibiscus Tea=45" "Blue Pea Tea=60" "Lemon Grass Tea=45" "Oolong Tea=45" \
  "Chamomile Tea=45" "Jasmine Tea=60" "Lavender Tea=45" "Rose Tea=45" \
  "Ayush Tea=45" "Pepper Mint Tea=45"

section "Healthy Breakfast" \
  "Veg Salad=75" "Fruit Bowl=85" "Oat Meal=90" "Corn Flakes=100" "Fruit Salad=150"

section "Immunity Boosters" \
  "TVANAMM's Spl Juice=75" "Aloevera Juice=55" "Wheat Grass Juice=55" \
  "Ragi Java (Sweet)=65" "Ragi Java (Curd)=65" "Ash Gourd Juice=65"

section "Healthy Juices" \
  "Carrot=85" "Banana=65" "Papaya=75" "Beetroot=85" "Apple Juice=85" "Kiwi=85" \
  "Water Melon=65" "Pine Apple=65" "Musk Melon=65" "Grapes=75" "Orange=75" \
  "Mango (Seasonal)=85" "Strawberry (Seasonal)=85" "Pomegranate=85" "Sapota=85" \
  "Dragon=125" "Avacado Juice=145"

section "Milk Shakes" \
  "Chocolate Milk Shake=114" "Oreo=114" "Kit Kat=114" "Snickers=114" \
  "Black Current=114" "Strawberry=114" "Banana=114" "Litchi=114" "Guava=114" \
  "Pineapple=114" "Falooda=114"

section "Smoothies" \
  "Banana Dates=114" "Anjeer Dryfruit=144"

section "Premium Shakes" \
  "Belgium Explode=194" "Belgium Dark Chocolate=184" "Ferrero=174" "Choco Oreo=164" \
  "Peanut Butter Oreo=184" "Chocolate Brownie=184" "Nutella Brownie=194" \
  "Peanut Butter Banana=164" "Snickers Premium=164" "Kitkat Premium=164"

section "Mocktails" \
  "Lime & Mint=85" "Lime & Ginger=85" "Fruit Twist=95" "Blue Berry=95" \
  "Blue Curacao=95" "Ras Berry=95"

section "Refreshing Drinks" \
  "Fresh Lime Soda=65" "Nannari Sharabath=70" "Butter Milk=45" "Lassi=65" \
  "Strawberry Lassi=75" "Mango Lassi=75" "Dryfruit Lassi=105" "Sarja Water=45"

section "Ice Creams" \
  "American Dry Fruit=135" "Caramel Nuts=125" "Black Current Ice Cream=105" \
  "Chocolate=105" "Butter Scotch=95" "Strawberry Ice Cream=95" "Vanilla=85" \
  "Fruit Custard=105" "Fruit Custard with Ice Cream=135" "Ice Cream with Fruit Salad=135"

section "Snacks" \
  "Sandwich (Plain)=60" "Sandwich (Grilled)=70" "Sandwich (Cheese)=90" "Maggie=50" \
  "Cheese Maggie=60" "Osmania Biscuits (1pc)=6" "French Fries=110" "Peri Peri Fries=110" \
  "Veg Nuggets=110" "Cheese Balls=110" "Veg Fingers=110" "Potato Cheese Shots=110" \
  "Onion Rings=110" "Veg Momos=110" "Paneer Momos=120" "Pasta (White/Red Sauce)=120"

echo "== publish to Demo Outlet =="
curl -s -b "$J" -H "origin:$BASE" -X POST "$BASE/api/v1/menu-publications" \
  -H 'content-type: application/json' \
  -d "{\"brandId\":\"$BRAND\",\"scope\":\"master\",\"targetOutletIds\":[\"$OUTLET\"],\"notes\":\"T VANAMM full menu\"}"
echo
