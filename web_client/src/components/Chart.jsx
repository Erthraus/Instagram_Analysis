import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer
} from "recharts";
import { useLanguage } from "../i18n/index.js";

/**
 * Chart — follower + following count history line chart using recharts.
 * Requires snapshot.history = [{ timestamp, follower_count, following_count? }, ...]
 */
export function Chart({ history = [] }) {
    const { t } = useLanguage();

    if (history.length < 2) {
        return (
            <div className="chart-placeholder">
                {t("chartNoData")}
            </div>
        );
    }

    const hasFollowing = history.some(e => e.following_count != null);

    const data = history.map(entry => ({
        date: new Date(entry.timestamp).toLocaleDateString(),
        [t("chartFollowers")]: entry.follower_count,
        ...(hasFollowing && entry.following_count != null
            ? { [t("chartFollowing")]: entry.following_count }
            : {}),
    }));

    return (
        <div className="chart-container">
            <h3 className="chart-title">{t("chartTitle")}</h3>
            <ResponsiveContainer width="100%" height={220}>
                <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                    <XAxis
                        dataKey="date"
                        tick={{ fill: "#888", fontSize: 11 }}
                        tickLine={false}
                    />
                    <YAxis
                        tick={{ fill: "#888", fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={50}
                    />
                    <Tooltip
                        contentStyle={{
                            background: "#1a1a1a",
                            border: "1px solid #333",
                            borderRadius: "6px",
                            color: "#e0e0e0"
                        }}
                    />
                    {hasFollowing && <Legend wrapperStyle={{ fontSize: 11, color: "#888" }} />}
                    <Line
                        type="monotone"
                        dataKey={t("chartFollowers")}
                        stroke="#0095f6"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, fill: "#0095f6" }}
                    />
                    {hasFollowing && (
                        <Line
                            type="monotone"
                            dataKey={t("chartFollowing")}
                            stroke="#da77f2"
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4, fill: "#da77f2" }}
                            strokeDasharray="5 3"
                        />
                    )}
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}
