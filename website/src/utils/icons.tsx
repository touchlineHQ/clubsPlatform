import { ReactNode } from 'react';
import {
  IconStar, IconUsers, IconTarget, IconHeart, IconTrophy, IconShield,
  IconMapPin, IconCar, IconShirt, IconToolsKitchen2, IconLeaf,
  IconDog, IconUserPlus, IconUserCircle, IconBallFootball, IconCamera,
  IconAward, IconHeartHandshake, IconMail, IconInfoCircle, IconHelp,
  IconHome, IconCalendar, IconCreditCard, IconId, IconNews, IconPhoto,
  IconChartLine, IconSettings,
} from '@tabler/icons-react';

/** Map FontAwesome class names (fa-xxx) to Tabler icons. */
function buildMap(size: number): Record<string, ReactNode> {
  return {
    'fa-star':           <IconStar size={size} />,
    'fa-users':          <IconUsers size={size} />,
    'fa-bullseye':       <IconTarget size={size} />,
    'fa-heart':          <IconHeart size={size} />,
    'fa-trophy':         <IconTrophy size={size} />,
    'fa-shield-alt':     <IconShield size={size} />,
    'fa-map-marker-alt': <IconMapPin size={size} />,
    'fa-car':            <IconCar size={size} />,
    'fa-shirt':          <IconShirt size={size} />,
    'fa-utensils':       <IconToolsKitchen2 size={size} />,
    'fa-leaf':           <IconLeaf size={size} />,
    'fa-paw':            <IconDog size={size} />,
    'fa-user-plus':      <IconUserPlus size={size} />,
    'fa-child':          <IconUserCircle size={size} />,
    'fa-venus':          <IconUserCircle size={size} />,
    'fa-female':         <IconUserCircle size={size} />,
    'fa-futbol':         <IconBallFootball size={size} />,
    'fa-camera':         <IconCamera size={size} />,
    'fa-award':          <IconAward size={size} />,
    'fa-handshake':      <IconHeartHandshake size={size} />,
    'fa-envelope':       <IconMail size={size} />,
    'fa-info-circle':    <IconInfoCircle size={size} />,
    'fa-chart-line':     <IconChartLine size={size} />,
    // Navigation icons
    'fa-home':           <IconHome size={size} />,
    'fa-calendar':       <IconCalendar size={size} />,
    'fa-credit-card':    <IconCreditCard size={size} />,
    'fa-id-card':        <IconId size={size} />,
    'fa-newspaper':      <IconNews size={size} />,
    'fa-images':         <IconPhoto size={size} />,
    'fa-cog':            <IconSettings size={size} />,
  };
}

/** Return the Tabler icon corresponding to a FontAwesome class name, or a fallback icon if not found. */
export function tablerIcon(faClass: string, size = 18): ReactNode {
  return buildMap(size)[faClass] ?? <IconHelp size={size} />;
}
