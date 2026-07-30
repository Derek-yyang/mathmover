"use client";

import { motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // 使用 ref 来保存上一个 pathname，避免不必要的重新渲染或动画触发
  const prevPathname = useRef(pathname);

  useEffect(() => {
    if (pathname !== prevPathname.current) {
      window.scrollTo(0, 0);
      prevPathname.current = pathname;
    }
  }, [pathname]);

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, x: 10, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="w-full h-full overflow-y-auto overflow-x-hidden" // 确保滚动行为正常
    >
      {children}
    </motion.div>
  );
}
