import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";

const DOG = { width: 70, height: 50, x: 60 };

function makeObstacle(width, height, kind, nowGroundY) {
  return {
    id: `${kind}-${Math.random().toString(36).slice(2)}`,
    x: Dimensions.get("window").width + 20,
    y: nowGroundY - height,
    width,
    height,
    kind,
    cleared: false,
  };
}

function makeCoin(nowGroundY, flyTimer) {
  const minY = flyTimer > 0 ? 60 : nowGroundY - 170;
  const maxY = flyTimer > 0 ? nowGroundY - 110 : nowGroundY - 30;
  return {
    id: `coin-${Math.random().toString(36).slice(2)}`,
    x: Dimensions.get("window").width + 20,
    y: minY + Math.random() * (maxY - minY),
    size: 24,
  };
}

function makeFlag(nowGroundY) {
  return {
    id: `flag-${Math.random().toString(36).slice(2)}`,
    x: Dimensions.get("window").width + 20,
    y: nowGroundY - 190 + Math.random() * 70,
    width: 44,
    height: 34,
  };
}

export default function App() {
  const [tick, setTick] = useState(0);
  const [layout, setLayout] = useState(Dimensions.get("window"));
  const gameRef = useRef({
    running: false,
    gameOver: false,
    score: 0,
    highScore: 0,
    speed: 290,
    time: 0,
    spawnTimer: 0.9,
    coinTimer: 1.5,
    flagTimer: 8,
    flyTimer: 0,
    dogY: 0,
    dogVY: 0,
    onGround: true,
    obstacles: [],
    coins: [],
    flags: [],
  });
  const lastRef = useRef(0);

  const groundY = useMemo(() => layout.height - 80, [layout.height]);

  useEffect(() => {
    const g = gameRef.current;
    if (!g.dogY) {
      g.dogY = groundY - DOG.height;
    }
  }, [groundY]);

  useEffect(() => {
    let raf = 0;
    const loop = (ts) => {
      if (!lastRef.current) {
        lastRef.current = ts;
      }
      const dt = Math.min(0.033, (ts - lastRef.current) / 1000);
      lastRef.current = ts;
      step(dt);
      setTick((v) => v + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });

  const step = (dt) => {
    const g = gameRef.current;
    if (!g.running || g.gameOver) return;

    g.time += dt;
    g.score += dt * 11;
    g.speed = Math.min(620, 290 + g.time * 7);

    if (g.flyTimer > 0) {
      g.flyTimer -= dt;
      g.dogVY += 900 * dt;
      if (g.dogY > groundY - 130) {
        g.dogVY -= 1500 * dt;
      }
      if (g.dogY < 45) {
        g.dogY = 45;
        g.dogVY = Math.max(0, g.dogVY);
      }
    } else {
      g.dogVY += 1700 * dt;
    }
    g.dogY += g.dogVY * dt;
    if (g.dogY >= groundY - DOG.height) {
      g.dogY = groundY - DOG.height;
      g.dogVY = 0;
      g.onGround = true;
    }

    g.spawnTimer -= dt;
    if (g.spawnTimer <= 0) {
      if (Math.random() < 0.34) {
        const tall = Math.random() < 0.45;
        g.obstacles.push(makeObstacle(tall ? 38 : 34, tall ? 66 : 58, "harvard", groundY));
      } else {
        const count = 1 + Math.floor(Math.random() * Math.min(4, 2 + Math.floor(g.time / 20)));
        let cursor = 0;
        for (let i = 0; i < count; i++) {
          const w = Math.random() < 0.4 ? 34 : 30;
          const h = w === 34 ? 64 : 56;
          g.obstacles.push({
            ...makeObstacle(w, h, "police", groundY),
            x: Dimensions.get("window").width + 20 + cursor,
          });
          cursor += w + (5 + Math.floor(Math.random() * 10));
        }
      }
      const min = 0.76;
      const max = 1.35;
      g.spawnTimer = Math.max(0.55, min + Math.random() * (max - min) - ((g.speed - 290) / 330) * 0.2);
    }

    g.coinTimer -= dt;
    if (g.coinTimer <= 0) {
      g.coins.push(makeCoin(groundY, g.flyTimer));
      if (g.flyTimer > 0 && Math.random() < 0.6) {
        g.coins.push(makeCoin(groundY, g.flyTimer));
      }
      g.coinTimer = g.flyTimer > 0 ? 0.4 + Math.random() * 0.5 : 1.8 + Math.random() * 1.9;
    }

    g.flagTimer -= dt;
    if (g.flagTimer <= 0) {
      g.flags.push(makeFlag(groundY));
      g.flagTimer = 11 + Math.random() * 7;
    }

    for (const ob of g.obstacles) {
      ob.x -= g.speed * dt;
      if (!ob.cleared && ob.x + ob.width < DOG.x - 2) {
        g.score += ob.kind === "harvard" ? 45 : 18;
        ob.cleared = true;
      }
    }
    for (const coin of g.coins) {
      coin.x -= (g.speed - 22) * dt;
    }
    for (const flag of g.flags) {
      flag.x -= (g.speed - 18) * dt;
    }

    g.obstacles = g.obstacles.filter((ob) => ob.x + ob.width > -20);
    g.coins = g.coins.filter((coin) => coin.x + coin.size > -20);
    g.flags = g.flags.filter((flag) => flag.x + flag.width > -20);

    // Collisions
    const pad = 8;
    for (const ob of g.obstacles) {
      const hit =
        DOG.x + pad < ob.x + ob.width &&
        DOG.x + DOG.width - pad > ob.x &&
        g.dogY + pad < ob.y + ob.height &&
        g.dogY + DOG.height - pad > ob.y;
      if (hit) {
        g.gameOver = true;
        g.running = false;
        g.highScore = Math.max(g.highScore, Math.floor(g.score));
        break;
      }
    }

    g.coins = g.coins.filter((coin) => {
      const hit =
        DOG.x + 4 < coin.x + coin.size &&
        DOG.x + DOG.width - 4 > coin.x &&
        g.dogY + 4 < coin.y + coin.size &&
        g.dogY + DOG.height - 4 > coin.y;
      if (hit) {
        g.score += 30;
        return false;
      }
      return true;
    });

    g.flags = g.flags.filter((flag) => {
      const hit =
        DOG.x + 4 < flag.x + flag.width &&
        DOG.x + DOG.width - 4 > flag.x &&
        g.dogY + 4 < flag.y + flag.height &&
        g.dogY + DOG.height - 4 > flag.y;
      if (hit) {
        g.flyTimer = 5;
        g.score += 120;
        g.dogVY = -440;
        g.onGround = false;
        g.coinTimer = 0.2;
        g.coins.push(makeCoin(groundY, g.flyTimer), makeCoin(groundY, g.flyTimer));
        return false;
      }
      return true;
    });
  };

  const onPressGame = () => {
    const g = gameRef.current;
    if (!g.running && !g.gameOver) {
      g.running = true;
      return;
    }
    if (g.gameOver) {
      gameRef.current = {
        ...gameRef.current,
        running: true,
        gameOver: false,
        score: 0,
        speed: 290,
        time: 0,
        spawnTimer: 0.9,
        coinTimer: 1.2,
        flagTimer: 8,
        flyTimer: 0,
        dogY: groundY - DOG.height,
        dogVY: 0,
        onGround: true,
        obstacles: [],
        coins: [],
        flags: [],
      };
      return;
    }
    if (g.flyTimer > 0) {
      g.dogVY = -430;
      return;
    }
    if (g.onGround) {
      g.dogVY = -600;
      g.onGround = false;
    }
  };

  const g = gameRef.current;
  void tick;

  return (
    <Pressable
      style={styles.container}
      onPress={onPressGame}
      onLayout={(e) => setLayout(e.nativeEvent.layout)}
    >
      <StatusBar style="dark" />

      <View style={styles.sky} />
      <View style={[styles.park, { top: groundY - 46 }]} />
      <View style={[styles.road, { top: groundY }]} />

      {g.obstacles.map((ob) =>
        ob.kind === "harvard" ? (
          <View key={ob.id} style={[styles.harvard, { left: ob.x, top: ob.y, width: ob.width, height: ob.height }]}>
            <View style={styles.harvardHead} />
            <View style={styles.harvardShirt}><Text style={styles.hText}>H</Text></View>
          </View>
        ) : (
          <View key={ob.id} style={[styles.police, { left: ob.x, top: ob.y, width: ob.width, height: ob.height }]}>
            <View style={styles.policeHead} />
            <View style={styles.policeBody} />
          </View>
        )
      )}

      {g.coins.map((coin) => (
        <View key={coin.id} style={[styles.coin, { left: coin.x, top: coin.y, width: coin.size, height: coin.size }]} />
      ))}

      {g.flags.map((flag) => (
        <View key={flag.id} style={[styles.flagWrap, { left: flag.x, top: flag.y, width: flag.width, height: flag.height }]}>
          <View style={styles.flagPole} />
          <View style={styles.flag}><Text style={styles.flagY}>Y</Text></View>
        </View>
      ))}

      <View style={[styles.dogWrap, { left: DOG.x, top: g.dogY }]}>
        <View style={styles.board} />
        <View style={styles.wheelLeft} />
        <View style={styles.wheelRight} />
        <View style={styles.dogBody} />
        <View style={styles.dogHead} />
        <View style={styles.dogEarLeft} />
        <View style={styles.dogEarRight} />
        <View style={styles.dogNose} />
        <View style={styles.cap}><Text style={styles.capY}>Y</Text></View>
      </View>

      <Text style={styles.score}>HI {String(Math.floor(g.highScore)).padStart(5, "0")}  {String(Math.floor(g.score)).padStart(5, "0")}</Text>
      {g.flyTimer > 0 ? <Text style={styles.fly}>FLY {g.flyTimer.toFixed(1)}s</Text> : null}
      {!g.running && !g.gameOver ? <Text style={styles.center}>Tap to start</Text> : null}
      {g.gameOver ? <Text style={styles.center}>Game Over - Tap to restart</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5fbff" },
  sky: { ...StyleSheet.absoluteFillObject, backgroundColor: "#dff4ff" },
  park: { position: "absolute", left: 0, right: 0, height: 46, backgroundColor: "#d7edcf" },
  road: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "#d6ecf8" },

  score: { position: "absolute", right: 16, top: 18, fontWeight: "700", color: "#1f2f47" },
  fly: { position: "absolute", left: 16, top: 18, fontWeight: "700", color: "#1d3f99" },
  center: { position: "absolute", alignSelf: "center", top: "40%", fontWeight: "700", color: "#1f2f47" },

  police: { position: "absolute" },
  policeHead: { position: "absolute", top: 8, left: 8, width: 14, height: 12, borderRadius: 6, backgroundColor: "#f2c7a7" },
  policeBody: { position: "absolute", top: 20, left: 4, width: 22, height: 22, borderRadius: 6, backgroundColor: "#2d4f7e" },

  harvard: { position: "absolute" },
  harvardHead: { position: "absolute", top: 7, left: 10, width: 16, height: 13, borderRadius: 6, backgroundColor: "#6e4a35" },
  harvardShirt: {
    position: "absolute",
    top: 20,
    left: 7,
    width: 24,
    height: 21,
    borderRadius: 5,
    backgroundColor: "#9e1b32",
    alignItems: "center",
    justifyContent: "center",
  },
  hText: { color: "#fff", fontWeight: "800" },

  coin: { position: "absolute", borderRadius: 20, backgroundColor: "#f3c745", borderWidth: 2, borderColor: "#d4a125" },

  flagWrap: { position: "absolute" },
  flagPole: { position: "absolute", left: 2, top: 2, width: 3, height: 30, borderRadius: 2, backgroundColor: "#c8a164" },
  flag: {
    position: "absolute",
    left: 6,
    top: 4,
    width: 34,
    height: 22,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    backgroundColor: "#1d3f99",
    justifyContent: "center",
    alignItems: "center",
  },
  flagY: { color: "#fff", fontWeight: "900" },

  dogWrap: { position: "absolute", width: DOG.width, height: DOG.height },
  board: { position: "absolute", left: 2, top: 40, width: 66, height: 8, borderRadius: 4, backgroundColor: "#c62026" },
  wheelLeft: { position: "absolute", left: 14, top: 47, width: 8, height: 8, borderRadius: 4, backgroundColor: "#242a33" },
  wheelRight: { position: "absolute", left: 54, top: 47, width: 8, height: 8, borderRadius: 4, backgroundColor: "#242a33" },
  dogBody: { position: "absolute", left: 14, top: 20, width: 42, height: 22, borderRadius: 10, backgroundColor: "#d29b46" },
  dogHead: { position: "absolute", left: 38, top: 9, width: 24, height: 17, borderRadius: 8, backgroundColor: "#d6a04d" },
  dogEarLeft: { position: "absolute", left: 39, top: 12, width: 5, height: 11, borderRadius: 3, backgroundColor: "#ae7632" },
  dogEarRight: { position: "absolute", left: 54, top: 12, width: 5, height: 11, borderRadius: 3, backgroundColor: "#ae7632" },
  dogNose: { position: "absolute", left: 56, top: 18, width: 4, height: 3, borderRadius: 2, backgroundColor: "#0f1319" },
  cap: {
    position: "absolute",
    left: 38,
    top: 3,
    width: 20,
    height: 9,
    borderRadius: 3,
    backgroundColor: "#1e3d94",
    justifyContent: "center",
    alignItems: "center",
  },
  capY: { color: "#fff", fontSize: 8, fontWeight: "900", marginTop: -1 },
});
